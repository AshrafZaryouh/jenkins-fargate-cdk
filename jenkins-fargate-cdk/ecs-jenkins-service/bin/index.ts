#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DEFAULT_STAGE } from '../../config';
import { JenkinsServiceStack } from '../lib/jenkins-fargate-stack';

const app = new cdk.App();
const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
};
const stage = app.node.tryGetContext('stage') || DEFAULT_STAGE;

const serviceName = 'jenkins';
new JenkinsServiceStack(app, `ecs-jenkins-fargate-${stage}`, {
    env,
    stage,
    serviceName,
    description: 'ECS Fargate service for Jenkins Master',
    terminationProtection: stage!==DEFAULT_STAGE
});
