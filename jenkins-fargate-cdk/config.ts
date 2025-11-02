import * as cdk from 'aws-cdk-lib';

export const SSM_PREFIX = '/jenkins-fargate-cdk';

export const CLUSTER_NAME = 'devops-fargate';

export const DEFAULT_STAGE = 'dev';

export interface StackCommonProps extends cdk.StackProps {
    stage: string;
}