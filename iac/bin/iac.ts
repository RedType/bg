#!/usr/bin/env node

import 'source-map-support/register';

import { Construct } from 'constructs';
import type { Stage } from '../lib/types';

import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as pipes from 'aws-cdk-lib/pipelines';
import * as route53 from 'aws-cdk-lib/aws-route53';

import BackendStack from '../lib/BackendStack';
import CdkPipelineStack from '../lib/CdkPipelineStack';
import DnsStack from '../lib/DnsStack';
import FrontendStack from '../lib/FrontendStack';
import EcrPipeline from '../lib/util/EcrPipeline';
import PollParameterStep from '../lib/util/PollParameterStep';

const app = new cdk.App();

/////////////////////////////////////////////////////////////////////
// Full Stack Definition                                           //
// (input stage-specific props in Deployment Stages section below) //
/////////////////////////////////////////////////////////////////////

const githubSecret = cdk.SecretValue.secretsManager('github-token');

interface DnsStageProps extends cdk.StageProps {
}

class DnsStage extends cdk.Stage {
  public readonly cert: acm.Certificate;
  public readonly domain: string;
  public readonly zone: route53.PublicHostedZone;

  constructor(scope: Construct, id: string, props: DnsStageProps) {
    super(scope, id, props);

    const zoneStack = new DnsStack(this, 'DnsStack', {
      domain: '', //TBD
    });

    this.cert = zoneStack.cert;
    this.domain = zoneStack.domain;
    this.zone = zoneStack.zone;
  }
}

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
  domain: string;
  stage: Stage;
  zone: route53.IHostedZone;
}

class App extends cdk.Stage {
  constructor(scope: Construct, id: string, props: AppProps) {
    super(scope, id, props);

    new BackendStack(this, 'BackendStack', {
      cert: dnsStage.cert,
      domain: props.domain,
      ecr: props.apiEcr,
      stage: props.stage,
      tagParameter: props.apiTag,
      zone: props.zone,
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
  repository: {
    name: 'RedType/bg',
    branch: 'deploy/cdk',
    path: 'iac',
    secret: githubSecret,
  },
});

const dnsStage = new DnsStage(cdkPipes, 'DnsStage', {});
cdkPipes.pipes.addStage(dnsStage);

for (const stage of ['dev', 'prod'] as Stage[]) {
  const subPipes = new SubPipes(cdkPipes, `${stage}/SubPipes`, {
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
    stage,
    apiEcr: subPipes.apiEcr,
    apiTag: subPipes.apiTag,
    domain: dnsStage.domain,
    zone: dnsStage.zone,
  }));
}

app.synth();

