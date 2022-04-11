import { Construct } from 'constructs';
import { Stage } from './types';

import * as cdk from 'aws-cdk-lib';
import * as api from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ssm from 'aws-cdk-lib/aws-ssm';

export interface BackendStackProps extends cdk.StackProps {
  domain: string;
  ecr: ecr.IRepository;
  stage: Stage;
  tagParameter: string;
  zone: route53.IHostedZone;
}

export default class BackendStack extends cdk.Stack {
  public readonly apiKeyParameter: string;
  public readonly url: string;

  constructor(scope: Construct, id: string, props: BackendStackProps) {
    super(scope, id, props);

    //////////////
    // database //
    //////////////

    const matchTable = new dynamodb.Table(this, 'MatchTable', {
      partitionKey: { name: 'match', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'move', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    /////////////
    // handler //
    /////////////

    const apiHandler = new lambda.DockerImageFunction(this, 'ApiHandler', {
      description: 'API Handler',
      code: lambda.DockerImageCode.fromEcr(props.ecr, {
        tag: ssm.StringParameter.valueForStringParameter(this, props.tagParameter),
      }),
    });
    matchTable.grantReadWriteData(apiHandler);

    /////////////////
    // api gateway //
    /////////////////

    const gateway = new api.LambdaRestApi(this, 'ApiGateway', {
      handler: apiHandler,
      proxy: false,
    });
    this.url = gateway.url;

    const match = gateway.root.addResource('match');

    // /match/new
    const newMatch = match.addResource('new');
    newMatch.addMethod('POST');

    // /match/{id}
    const byId = match.addResource('{id}');
    byId.addMethod('GET');
    byId.addMethod('POST');

    new route53.CnameRecord(this, 'APICnameRecord', {
      recordName: props.stage === 'prod' ? 'api' : `${props.stage}.api`,
      zone: props.zone,
      domainName: gateway.url,
    });
  }
}

