import { Construct } from 'constructs';
import type { GithubRepository } from './types';

import * as cdk from 'aws-cdk-lib';
import * as pipes from 'aws-cdk-lib/pipelines';

export interface CdkPipelineStackProps extends cdk.StackProps {
  repository: GithubRepository;
}

export default class CdkPipelineStack extends cdk.Stack {
  public readonly name: string;
  public readonly pipes: pipes.CodePipeline;

  constructor(scope: Construct, id: string, props: CdkPipelineStackProps) {
    super(scope, id, props);

    const repo = props.repository;

    this.name = id;
    this.pipes = new pipes.CodePipeline(this, 'CdkPipeline', {
      pipelineName: id,
      synth: new pipes.ShellStep('Synth', {
        input: pipes.CodePipelineSource.gitHub(
          repo.name,
          repo.branch || 'deploy',
          { authentication: repo.secret },
        ),
        commands: [
          repo.path ? `cd ${repo.path}` : '',
          'npm ci',
          'npm run build',
          'npx cdk synth',
        ].filter(cmd => !!cmd),
        primaryOutputDirectory: repo.path ? `${repo.path}/cdk.out` : undefined,
      }),
    });
  }
}

