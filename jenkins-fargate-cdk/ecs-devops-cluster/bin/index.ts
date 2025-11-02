#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';

import { DEFAULT_STAGE, CLUSTER_NAME } from '../../config';
import { DevOpsClusterStack } from '../lib/devops-cluster-stack';

const app = new cdk.App();
const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
};
const stage = app.node.tryGetContext('stage') || DEFAULT_STAGE;

new DevOpsClusterStack(app, `ecs-devops-cluster-${CLUSTER_NAME}-${stage}`, {
    env,
    stage,
    description: `ECS Fargate cluster, cluster name: ${CLUSTER_NAME}-${stage}`,
    terminationProtection: stage!==DEFAULT_STAGE
});
