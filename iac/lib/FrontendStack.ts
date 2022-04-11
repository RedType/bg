import { Construct } from 'constructs';
import { Stage } from './types';

import * as cdk from 'aws-cdk-lib';

export interface FrontendStackProps extends cdk.StackProps {
  stage: Stage;
}

export default class FrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);
  }
}

