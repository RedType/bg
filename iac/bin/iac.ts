#!/usr/bin/env node

import 'source-map-support/register';

import { Construct } from 'constructs';
import type { Stage } from '../lib/types';

import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as pipes from 'aws-cdk-lib/pipelines';

import BackendStack from '../lib/BackendStack';
import CdkPipelineStack from '../lib/CdkPipelineStack';
import DnsStack from '../lib/DnsStack';
import FrontendStack from '../lib/FrontendStack';
import EcrPipeline from '../lib/util/EcrPipeline';
import PollParameterStep from '../lib/util/PollParameterStep';

const env = {
  account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION,
};

const app = new cdk.App();

/////////////////////////////////////////////////////////////////////
// Full Stack Definition                                           //
// (input stage-specific props in Deployment Stages section below) //
/////////////////////////////////////////////////////////////////////

const githubSecret = cdk.SecretValue.secretsManager('github-token');

interface SubPipesProps extends cdk.StageProps {
  cdkPipeline: string;
  stage: Stage;
}

class SubPipes extends cdk.Stage {
  public readonly apiEcr: ecr.Repository;
  public readonly apiTag: string;

  constructor(scope: Construct, id: string, props: SubPipesProps) {
    super(scope, id, props);

    const apiHandlerPipes = new EcrPipeline(this, 'ApiHandlerPipeline', {
      repository: {
        name: 'RedType/bg',
        branch: `deploy/${props.stage}/apiFn`,
        path: 'apiFn',
        secret: githubSecret,
      },
      stage: props.stage,
    });

    this.apiEcr = apiHandlerPipes.ecr;
    this.apiTag = apiHandlerPipes.tagParameter;
  }
}

interface AppProps extends cdk.StageProps {
  apiEcr: ecr.IRepository;
  apiTag: string;
  stage: Stage;
}

class App extends cdk.Stage {
  constructor(scope: Construct, id: string, props: AppProps) {
    super(scope, id, props);

    const zoneStack = new DnsStack(this, 'DnsStack', {
      domain: '', //TBD
      stage: props.stage,
    });

    new BackendStack(this, 'BackendStack', {
      domain: zoneStack.domain,
      ecr: props.apiEcr,
      stage: props.stage,
      tagParameter: props.apiTag,
      zone: zoneStack.zone,
    });

    new FrontendStack(this, 'FrontendStack', {
      stage: props.stage,
    });
  }
}

///////////////////////////////////////////////////////////////
// CDK Code Pipeline & Stages                                //
// (the thing that deploys changes to this app's definition) //
///////////////////////////////////////////////////////////////

const cdkPipes = new CdkPipelineStack(app, 'CdkPipeline', {
  env,
  repository: {
    name: 'RedType/bg',
    branch: 'deploy/cdk',
    path: 'iac',
    secret: githubSecret,
  },
});

for (const stage of ['dev', 'prod'] as Stage[]) {
  const subPipes = new SubPipes(cdkPipes, `${stage}/SubPipes`, {
    env,
    stage,
    cdkPipeline: cdkPipes.name,
  });

  cdkPipes.pipes.addStage(subPipes, {
    pre: stage === 'prod'
      ? [new pipes.ManualApprovalStep('PromoteToProd')]
      : undefined
    ,
    post: [subPipes.apiTag].map(tag =>
      new PollParameterStep('WaitForImages', {
        parameter: tag,
        untilNot: EcrPipeline.DRY_RUN_TAG,
      })
    ),
  });

  cdkPipes.pipes.addStage(new App(cdkPipes, `${stage}/App`, {
    env, stage,
    apiEcr: subPipes.apiEcr,
    apiTag: subPipes.apiTag,
  }));
}

