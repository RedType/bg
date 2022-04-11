import { Construct } from 'constructs';
import type { Stage, GithubRepository } from '../types';

import * as cdk from 'aws-cdk-lib';
import * as cb from 'aws-cdk-lib/aws-codebuild';
import * as cp from 'aws-cdk-lib/aws-codepipeline';
import * as cpa from 'aws-cdk-lib/aws-codepipeline-actions';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sm from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';

export interface EcrPipelineProps extends cdk.StackProps {
  // extra environment variables to add to build environment
  additionalBuildEnv?: Record<string, string>;
  // secrets (in aws secretsmanager) to add to build environment
  additionalBuildSecrets?: Record<string, string>;
  // optionally accept docker hub credentials to avoid throttling
  dockerHub?: {
    account: string;
    secret: string;
  };
  // github repository to source from
  repository: GithubRepository;
  stage: Stage;
  // pipelines that will be triggered after this one finishes
  triggerPipelines?: string[];
}

export default class EcrPipeline extends cdk.Stack {
  protected readonly pipes: cp.Pipeline;
  protected readonly source: cp.Artifact;
  protected readonly build: cp.Artifact;

  public readonly ecr: ecr.Repository;
  public readonly tagParameter: string;

  public static readonly DRY_RUN_TAG = 'none';

  constructor(scope: Construct, id: string, props: EcrPipelineProps) {
    super(scope, id, props);

    const { account, region } = cdk.Stack.of(this);
    const [owner, repo] = props.repository.name.split('/');
    const triggerPipes = props.triggerPipelines ?? [];

    this.pipes = new cp.Pipeline(this, 'Pipeline');
    this.source = new cp.Artifact();
    this.build = new cp.Artifact();
    this.ecr = new ecr.Repository(this, 'Ecr');
    this.tagParameter = `/${this.node.path}/EcrTag`;
    const tagP = new ssm.StringParameter(this, 'EcrTagParameter', {
      parameterName: this.tagParameter,
      stringValue: EcrPipeline.DRY_RUN_TAG, // will be overwritten
    });

    ////////////
    // source //
    ////////////

    this.pipes.addStage({
      stageName: 'source',
      actions: [
        // this is auto-triggered by webhook on branch commit
        new cpa.GitHubSourceAction({
          actionName: 'source',
          owner, repo,
          branch: props.repository.branch || `deploy/${props.stage}`,
          oauthToken: props.repository.secret,
          output: this.source,
        }),
      ],
    });

    ///////////////
    // build env //
    ///////////////

    const buildEnv: Record<string, { value: string }> = {
      STAGE: { value: props.stage },
      REPOSITORY_URI: { value: this.ecr.repositoryUri },
      DOCKER_HUB_ACCOUNT: { value: props.dockerHub?.account || '' },
    };

    for (const [key, value] of Object.entries(props.additionalBuildEnv ?? {})) {
      buildEnv[key] = { value };
    }

    // these will be passed into the container as build-arg variables
    // (do not pass secrets into image as ENV, as they will no longer be secret.
    //  however, it is ok to use them as ARG because they'll not be baked in to the image)
    const buildArgs = Object.entries(buildEnv)
      .map(([k, v]) => `--build-arg=${k}="${v.value}"`)
      .concat(Object.keys(props.additionalBuildSecrets ?? {})
        .map(k => `--build-arg=${k}="$${k}"`)
      )
      .join(' ')
    ;

    const allBuildSecrets = {
      DOCKER_HUB_SECRET: props.dockerHub?.secret || '',
      ...props.additionalBuildSecrets,
    };
    const fetchSecretsCommands = Object.entries(allBuildSecrets)
      .map(([envKey, id]) =>
        `${envKey}=$(` +
          // retrieve secret
          `aws secretsmanager get-secret-value --secret-id ${id}` +
          // extract it from json response
          ' | jq .SecretString' +
          // hack off the quotes
          ' | xargs echo' +
        ')"'
      )
    ;

    ///////////
    // build //
    ///////////

    const path = props.repository.path;
    const project = new cb.PipelineProject(this, 'BuildProject', {
      environment: {
        buildImage: cb.LinuxBuildImage.STANDARD_5_0,
        computeType: cb.ComputeType.SMALL,
        privileged: true,
        environmentVariables: buildEnv,
      },
      // to capture variables from the build, see example at
      // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_codebuild.BuildSpec.html
      buildSpec: cb.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [path ? `cd ${path}` : ''].filter(cmd => !!cmd),
          },
          pre_build: {
            commands: [
              // check to see if aws cli is available
              'aws --version',
              // retrieve secrets
              ...fetchSecretsCommands,
              // generate tag for docker image
              'COMMIT_HASH="$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)"',
              'IMAGE_TAG="${COMMIT_HASH:=latest}"',
              // if credentials were provided, log in to docker hub
              props.dockerHub
                ? 'docker login --username "$DOCKER_HUB_ACCOUNT" --password "$DOCKER_HUB_SECRET"'
                : ''
              ,
            ].filter(cmd => !!cmd),
          },
          build: {
            commands: [
              `docker build -t "$REPOSITORY_URI:latest" ${buildArgs} .`,
              'docker tag "$REPOSITORY_URI:latest" "$REPOSITORY_URI:$IMAGE_TAG"',
            ],
          },
          post_build: {
            commands: [
              // log in to ecr for image push
              props.dockerHub ? 'docker logout' : '',
              `aws ecr get-login-password --region "${region}"`
                + ' | docker login --username AWS --password-stdin'
                + `   "${account}.dkr.ecr.${region}.amazonaws.com"`
              ,
              'docker push "$REPOSITORY_URI:latest"',
              'docker push "$REPOSITORY_URI:$IMAGE_TAG"',
              'aws ssm put-parameter'
                + ` --name "${this.tagParameter}"`
                + ' --value "$IMAGE_TAG"'
                + ' --overwrite'
              ,
              ...triggerPipes.map(pipe =>
                `aws codepipeline start-pipeline-execution --name "${pipe}"`
              ),
            ].filter(cmd => !!cmd),
          },
        },
      }),
    });

    this.pipes.addStage({
      stageName: 'build',
      actions: [
        new cpa.CodeBuildAction({
          project,
          actionName: 'build',
          input: this.source,
        }),
      ],
    });

    /////////
    // IAM //
    /////////

    // grant project access to additional secrets
    for (const [key, id] of Object.entries(allBuildSecrets)) {
      sm.Secret.fromSecretNameV2(this, `BuildSecret_${key}`, id)
        .grantRead(project.grantPrincipal)
      ;
    }

    // allow project to push to repository
    this.ecr.grantPullPush(project.grantPrincipal);

    // allow project to edit tag parameter
    tagP.grantWrite(project.grantPrincipal);

    // allow cloudformation to read the parameter (when deploying other stacks
    new iam.Role(this, 'ReadParameterRole', {
      assumedBy: new iam.ServicePrincipal('cloudformation.amazonaws.com'),
      inlinePolicies: {
        ReadParameterPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['ssm:GetParameter', 'ssm:GetParameters'],
              resources: [tagP.parameterArn],
            }),
          ],
        }),
      },
    });

    // allow project to trigger pipelines
    if (triggerPipes.length > 0) {
      project.grantPrincipal.addToPrincipalPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['codepipeline:StartPipelineExecution'],
        resources: triggerPipes.map(pipe =>
          `arn:aws:codepipeline:${region}:${account}:${pipe}`
        ),
      }));
    }
  }
}

