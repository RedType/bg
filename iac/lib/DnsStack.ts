import { Construct } from 'constructs';
import { Stage } from './types';

import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';

export interface DnsStackProps extends cdk.StackProps {
  domain: string;
}

export default class DnsStack extends cdk.Stack {
  public readonly cert: acm.DnsValidatedCertificate;
  public readonly domain: string;
  public readonly zone: route53.PublicHostedZone;

  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, props);

    this.domain = props.domain;

    this.zone = new route53.PublicHostedZone(this, 'HostedZone', {
      zoneName: props.domain,
    });

    this.cert = new acm.DnsValidatedCertificate(this, 'Certificate', {
      domainName: props.domain,
      hostedZone: this.zone,
    });
  }
}

