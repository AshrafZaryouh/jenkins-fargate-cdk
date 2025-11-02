import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import { Stack, CfnOutput, Duration, Tags } from 'aws-cdk-lib';
import * as path from 'path';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';

import { StackCommonProps, SSM_PREFIX, CLUSTER_NAME } from '../../config';

export interface JenkinsServiceProps extends StackCommonProps {
    serviceName: string;
}
/**
 * Crearte Fargate Service, Auto Scaling, ALB, and Log Group.
 * Set the ALB logs for the production-level.
 */
export class JenkinsServiceStack extends Stack {
    constructor(scope: Construct, id: string, props: JenkinsServiceProps) {
        super(scope, id, props);

        const vpcId = this.node.tryGetContext('vpcId') || ssm.StringParameter.valueFromLookup(this, `${SSM_PREFIX}/vpc-id`);
        const vpc = ec2.Vpc.fromLookup(this, 'vpc', { vpcId });
        const clusterSgId = ssm.StringParameter.valueFromLookup(this, `${SSM_PREFIX}/cluster-securitygroup-id`);
        const ecsSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, 'ecs-security-group', clusterSgId);

        const cluster = ecs.Cluster.fromClusterAttributes(this, 'ecs-fargate-cluster', {
            clusterName: `${CLUSTER_NAME}-${props.stage}`,
            vpc,
            securityGroups: [ecsSecurityGroup]
        });
        const serviceName = props.serviceName;
        const containerName = `${serviceName}-container`
        const applicationPort = 8080;

        const executionRoleArn = ssm.StringParameter.valueFromLookup(this, `${SSM_PREFIX}/task-execution-role-arn`);
        const taskRoleArn = ssm.StringParameter.valueFromLookup(this, `${SSM_PREFIX}/default-task-role-arn`);

        const fileSystem = new efs.FileSystem(this, 'Efs', {
            vpc,
            performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
                onePerAz: true
            }
        });

        const taskDefinition = new ecs.TaskDefinition(this, 'fargate-task-definition', {
            cpu: '4096',
            memoryMiB: '4096',
            compatibility: ecs.Compatibility.FARGATE,
            family: `${serviceName}-task`,
            executionRole: iam.Role.fromRoleArn(this, 'task-execution-role', cdk.Lazy.string({ produce: () => executionRoleArn })),
            taskRole: iam.Role.fromRoleArn(this, 'task-role', cdk.Lazy.string({ produce: () => taskRoleArn })),
        });
        taskDefinition.addToTaskRolePolicy(
            new iam.PolicyStatement({
                actions: [
                    'elasticfilesystem:ClientRootAccess',
                    'elasticfilesystem:ClientWrite',
                    'elasticfilesystem:ClientMount',
                    'elasticfilesystem:DescribeMountTargets'
                ],
                resources: [`arn:aws:elasticfilesystem:${this.region}:${this.account}:file-system/${fileSystem.fileSystemId}`]
            })
        );

        const volumeName = 'efs-volume';
        const accessPoint = new efs.AccessPoint(this, 'AccessPoint', {
            fileSystem: fileSystem,
        });
        taskDefinition.addVolume({
            name: volumeName,
            efsVolumeConfiguration: {
                fileSystemId: fileSystem.fileSystemId,
                transitEncryption: 'ENABLED',
                authorizationConfig: {
                    accessPointId: accessPoint.accessPointId,
                    iam: 'ENABLED'
                }
            }
        });

        const logGroup = new logs.LogGroup(this, 'loggroup', {
            logGroupName: serviceName,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            retention: logs.RetentionDays.TWO_WEEKS,
        });
        const container = taskDefinition.addContainer('container-restapi', {
            containerName,
            image: ecs.ContainerImage.fromAsset(path.join(__dirname, "../../", "jenkins-docker")),
            // or build with app/build.sh
            // image: ecs.ContainerImage.fromRegistry("<account-id>.dkr.ecr.<region>.amazonaws.com/jenkins-fargate:latest"),
            cpu: 4096,
            memoryReservationMiB: 4096,
            logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'app' })
        });
        container.addPortMappings({ containerPort: applicationPort, hostPort: applicationPort });
        container.addMountPoints({
            containerPath: '/var/jenkins_home',
            sourceVolume: volumeName,
            readOnly: false
        });

        const fargateservice = new ecs.FargateService(this, 'ecs-fargate-service', {
            cluster,
            serviceName: `${serviceName}-${props.stage}`,
            taskDefinition,
            enableExecuteCommand: true,
            minHealthyPercent: 0,
            maxHealthyPercent: 100,
            healthCheckGracePeriod: Duration.seconds(0) // set the value as your application initialize time 
        });
        fargateservice.autoScaleTaskCount({
            minCapacity: 1,
            maxCapacity: 1
        });

        const albSecurityGroupName = `albsg-${serviceName}`
        const albSecurityGroup = new ec2.SecurityGroup(this, albSecurityGroupName, {
            securityGroupName: albSecurityGroupName,
            vpc,
            allowAllOutbound: true,
            description: `ALB security group for ${serviceName} Service`
        });
        ecsSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(applicationPort), 'Allow from ALB');
        albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow any')

        fileSystem.connections.allowDefaultPortFrom(fargateservice, 'Allow NFS from ECS Service')

        Tags.of(ecsSecurityGroup).add('Stage', props.stage);
        Tags.of(ecsSecurityGroup).add('Name', albSecurityGroupName);

        const alb = new elbv2.ApplicationLoadBalancer(this, 'alb', {
            securityGroup: albSecurityGroup,
            vpc,
            loadBalancerName: `alb-${serviceName}`,
            internetFacing: true,
            deletionProtection: false,
            idleTimeout: cdk.Duration.seconds(30),
        });
        alb.addListener('https-listener', {
            protocol: elbv2.ApplicationProtocol.HTTP,
            open: false,
        }).addTargets('ec2-service-target', {
            targetGroupName: `tg-${serviceName}`,
            port: applicationPort,
            protocol: elbv2.ApplicationProtocol.HTTP,
            targets: [fargateservice.loadBalancerTarget({
                containerName: containerName,
                containerPort: applicationPort,
            })],
            healthCheck: {
                healthyThresholdCount: 2,
                unhealthyThresholdCount: 5,
                interval: Duration.seconds(31),
                path: '/login',
                timeout: Duration.seconds(30),
            },
            deregistrationDelay: Duration.seconds(15)
        });

        new CfnOutput(this, 'ALB', { value: `http://${alb.loadBalancerDnsName}` });
        new CfnOutput(this, 'Service', { value: fargateservice.serviceArn });
        new CfnOutput(this, 'ServiceURL', { value: `https://${this.region}.console.aws.amazon.com/ecs/home?#/clusters/${cluster.clusterName}/services` });
        new CfnOutput(this, 'TaskDefinition', { value: taskDefinition.family });
        new CfnOutput(this, 'LogGroup', { value: logGroup.logGroupName });
        new CfnOutput(this, 'LogGroupURLForPassword', { value: `https://${this.region}.console.aws.amazon.com/ecs/home?#logsV2:log-groups/log-group/${logGroup.logGroupName}` });
    }
}