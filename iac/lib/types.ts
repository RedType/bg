import * as cdk from 'aws-cdk-lib';

export type Stage = 'dev' | 'prod';

export interface GithubRepository {
  name: string;
  branch?: string;
  path?: string;
  secret: cdk.SecretValue;
};

