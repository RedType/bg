import { Construct } from 'constructs';
import type { GithubRepository, Stage } from '../types';

import * as cdk from 'aws-cdk-lib';
import * as cb from 'aws-cdk-lib/aws-codebuild';
import * as cp from 'aws-cdk-lib/aws-codepipeline';
import * as cpa from 'aws-cdk-lib/aws-codepipeline-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';

export interface StaticNodePipelineProps extends cdk.StackProps {
  buildCommand?: string;
  outputDir?: string;
  repository: GithubRepository;
  stage: Stage;
  target: s3.IBucket;
}

export default class StaticNodePipeline extends cdk.Stack {
  protected readonly sourceArtifact: cp.Artifact;
  protected readonly buildArtifact: cp.Artifact;

  constructor(scope: Construct, id: string, props: StaticNodePipelineProps) {
    super(scope, id, props);

    this.sourceArtifact = new cp.Artifact();
    this.buildArtifact = new cp.Artifact();

    const pipes = new cp.Pipeline(this, 'Pipeline');

    const [owner, repo] = props.repository.name.split('/');
    pipes.addStage({
      stageName: 'source',
      actions: [
        new cpa.GitHubSourceAction({
          owner, repo,
          actionName: 'source',
          oauthToken: props.repository.secret,
          output: this.sourceArtifact,
        }),
      ],
    });

    const project = new cb.PipelineProject(this, 'BuildProject', {
      environment: {
        buildImage: cb.LinuxBuildImage.STANDARD_5_0,
        privileged: true,
      },
      cache: cb.Cache.local(cb.LocalCacheMode.DOCKER_LAYER),
      buildSpec: cb.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': {
              nodejs: '14.x',
            },
          },
          pre_build: {
            commands: [
              props.repository.path ? `cd ${props.repository.path}` : '',
              'npm ci',
            ].filter(cmd => !!cmd),
          },
          build: {
            commands: [
              props.buildCommand || 'npm run build',
            ],
          },
          post_build: {
            commands: [
              'aws s3 sync --delete ' +
                `${props.outputDir || 'dist'} ` +
                `s3://${props.target.bucketName}/`
              ,
            ],
          },
        },
      }),
    });

    project.grantPrincipal.addToPrincipalPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:PutObject',
        's3:GetObject',
        's3:ListBucket',
        's3:DeleteObject',
        's3:GetBucketLocation',
      ],
      resources: [
        props.target.bucketArn,
        props.target.bucketArn + '/*',
      ],
    }));

    pipes.addStage({
      stageName: 'build',
      actions: [
        new cpa.CodeBuildAction({
          actionName: 'build',
          input: this.sourceArtifact,
          project,
        }),
      ],
    });
  }
}

