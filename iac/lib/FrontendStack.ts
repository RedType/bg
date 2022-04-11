import { Construct } from 'constructs';
import type { GithubRepository, Stage } from './types';

import StaticNodePipeline from './util/StaticNodePipeline';

import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';

export interface FrontendStackProps extends cdk.StackProps {
  cert: acm.ICertificate;
  domain: string;
  repository: GithubRepository;
  stage: Stage;
  website?: {
    index: string;
    error?: string;
  },
}

export default class FrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'StaticAppBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      websiteIndexDocument: props.website?.index || 'index.html',
      websiteErrorDocument: props.website?.error,
    });

    new cf.Distribution(this, 'AppDistribution', {
      certificate: props.cert,
      defaultBehavior: { origin: new origins.S3Origin(bucket) },
      domainNames: [props.domain],
    });

    new StaticNodePipeline(this, 'AppPipeline', {
      repository: props.repository,
      stage: props.stage,
      target: bucket,
    });
  }
}

