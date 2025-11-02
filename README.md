# 🚀 Jenkins on AWS Fargate using AWS CDK — Complete Guide

---

## 🧠 What You’re Building

A **serverless Jenkins controller** deployed on **AWS Fargate (ECS)**.
You’ll use **AWS CDK** to define infrastructure as code (IaC).

**Architecture Diagram (conceptually):**

```
+-----------------------------+
|        AWS Cloud            |
|  +-----------------------+  |
|  |       VPC             |  |
|  |  +-----------------+  |  |
|  |  |  ECS Cluster    |  |  |
|  |  | +-------------+ |  |  |
|  |  | | Jenkins     | |  |  |
|  |  | | Container   | |  |  |
|  |  | +-------------+ |  |  |
|  |  +-----------------+  |  |
|  |   ↕                 |  |
|  |  EFS (Persistent)   |  |
|  +-----------------------+  |
|        ALB → Internet       |
+-----------------------------+
```

---

## ⚙️ Components

| Component                           | Description                                   |
| ----------------------------------- | --------------------------------------------- |
| **VPC**                             | Isolated network for Jenkins and ECS.         |
| **ECS Cluster (Fargate)**           | Orchestrates Jenkins containers.              |
| **EFS (Elastic File System)**       | Persists Jenkins data (/var/jenkins_home).    |
| **ALB (Application Load Balancer)** | Provides public HTTPS access.                 |
| **IAM Roles**                       | Grants ECS + Jenkins access to AWS resources. |
| **CDK Stack**                       | All infrastructure defined in code.           |

---

## 🧱 Folder Structure

```
jenkins-fargate-cdk/
├── bin/
│   └── jenkins-fargate.ts
├── lib/
│   └── jenkins-fargate-stack.ts
├── cdk.json
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🧰 Prerequisites

| Tool    | Version  | Purpose                       |
| ------- | -------- | ----------------------------- |
| AWS CLI | latest   | Auth and deploy               |
| Node.js | ≥ 18.x   | Run CDK                       |
| AWS CDK | ≥ 2.x    | Infrastructure as code        |
| Docker  | optional | To build custom Jenkins image |

### Setup commands

```bash
# Install AWS CDK CLI
npm install -g aws-cdk

# Configure AWS credentials
aws configure

# Create a new CDK project
mkdir jenkins-fargate-cdk && cd jenkins-fargate-cdk
cdk init app --language typescript
```

---

## 📦 `package.json`

```json
{
  "name": "jenkins-fargate-cdk",
  "version": "1.0.0",
  "bin": {
    "jenkins-fargate-cdk": "bin/jenkins-fargate.js"
  },
  "scripts": {
    "build": "tsc",
    "watch": "tsc -w",
    "cdk": "cdk",
    "deploy": "cdk deploy",
    "synth": "cdk synth",
    "destroy": "cdk destroy"
  },
  "devDependencies": {
    "aws-cdk-lib": "^2.150.0",
    "constructs": "^10.3.0",
    "typescript": "^5.2.2",
    "@types/node": "^20.0.0"
  }
}
```

---

## 🪄 `bin/jenkins-fargate.ts`

```typescript
#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { JenkinsFargateStack } from "../lib/jenkins-fargate-stack";

const app = new cdk.App();
new JenkinsFargateStack(app, "JenkinsFargateStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },
});
```

---

## 💻 `lib/jenkins-fargate-stack.ts`

```typescript
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as efs from "aws-cdk-lib/aws-efs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as iam from "aws-cdk-lib/aws-iam";

export class JenkinsFargateStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ✅ Create a VPC
    const vpc = new ec2.Vpc(this, "JenkinsVpc", {
      maxAzs: 2,
      natGateways: 1,
    });

    // ✅ Create ECS Cluster
    const cluster = new ecs.Cluster(this, "JenkinsCluster", { vpc });

    // ✅ EFS for Jenkins data
    const fileSystem = new efs.FileSystem(this, "JenkinsEfs", {
      vpc,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_7_DAYS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ✅ Task Role (permissions for Jenkins inside container)
    const taskRole = new iam.Role(this, "JenkinsTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    // Allow Jenkins to interact with S3, CloudWatch, etc. if needed
    taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess")
    );

    // ✅ Task Definition
    const taskDef = new ecs.FargateTaskDefinition(this, "JenkinsTaskDef", {
      cpu: 1024,
      memoryLimitMiB: 2048,
      taskRole,
    });

    // Add EFS Volume
    taskDef.addVolume({
      name: "jenkins-home",
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
      },
    });

    // ✅ Jenkins Container
    const container = taskDef.addContainer("JenkinsContainer", {
      image: ecs.ContainerImage.fromRegistry("jenkins/jenkins:lts-jdk17"),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "jenkins" }),
      environment: {
        JAVA_OPTS: "-Djenkins.install.runSetupWizard=false",
      },
    });

    container.addPortMappings({ containerPort: 8080 });
    container.addMountPoints({
      containerPath: "/var/jenkins_home",
      sourceVolume: "jenkins-home",
      readOnly: false,
    });

    // ✅ Fargate Service + ALB
    const service = new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      "JenkinsService",
      {
        cluster,
        taskDefinition: taskDef,
        desiredCount: 1,
        assignPublicIp: true,
        publicLoadBalancer: true,
      }
    );

    // Allow access to EFS
    fileSystem.connections.allowDefaultPortFrom(service.service);

    // ✅ Auto Scaling
    const scaling = service.service.autoScaleTaskCount({ maxCapacity: 3 });
    scaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 70,
    });

    // ✅ Output the Jenkins URL
    new cdk.CfnOutput(this, "JenkinsURL", {
      value: `http://${service.loadBalancer.loadBalancerDnsName}`,
    });
  }
}
```

---

## 🧩 Optional: HTTPS (TLS/SSL)

<img width="741" height="391" alt="jenkins-ca-python" src="https://github.com/user-attachments/assets/e21ad6c5-2e96-4703-92e8-fa2fad951dfa" />

Add an ACM certificate and enable HTTPS:

```typescript
import * as acm from "aws-cdk-lib/aws-certificatemanager";

const certificate = new acm.Certificate(this, "JenkinsCert", {
  domainName: "jenkins.example.com",
  validation: acm.CertificateValidation.fromDns(),
});

new ecs_patterns.ApplicationLoadBalancedFargateService(this, "JenkinsService", {
  cluster,
  taskDefinition: taskDef,
  publicLoadBalancer: true,
  certificate,
  redirectHTTP: true,
});
```

---

## 🚀 Deploying

1. **Bootstrap environment:**

   ```bash
   cdk bootstrap aws://<ACCOUNT_ID>/<REGION>
   ```

2. **Build and deploy:**

   ```bash
   npm install
   npm run build
   cdk deploy
   ```

3. **Get your Jenkins URL:**

   ```
   Outputs:
   JenkinsFargateStack.JenkinsURL = http://<your-alb-dns-name>
   ```

4. **Open it in browser → Jenkins ready!**

---

## 🔒 Security Best Practices

<img width="944" height="401" alt="devops_2093_1" src="https://github.com/user-attachments/assets/6d38b362-1674-413e-8535-9b459f389184" />

* Restrict ALB access via Security Groups or WAF.
* Store Jenkins credentials in **AWS Secrets Manager**.
* Use HTTPS with ACM certificate.
* Limit ECS task IAM permissions.
* Schedule automatic backups from `/var/jenkins_home` (EFS).

---

## 📈 Scaling & Monitoring

<img width="1015" height="594" alt="1_rlPRYAfJ_aFOfoj52U7y2A" src="https://github.com/user-attachments/assets/176e4d46-3593-4cd3-88ec-22f1999f9ae2" />

* Auto-scale Jenkins agents with **ECS or EC2** slaves.
* Monitor via **CloudWatch Logs + Metrics**.
* Add alarms for CPU, memory, and failed tasks.

---

## 🧰 Destroying the Stack

<img width="1024" height="487" alt="devops_2067_1-1024x487" src="https://github.com/user-attachments/assets/887169fa-4523-4e3b-a97b-5e3aac3c5242" />

When done testing:

```bash
cdk destroy
```

This removes all resources, including EFS (if `RemovalPolicy.DESTROY`).

---

## ✅ Summary

| Feature                | Description                  |
| ---------------------- | ---------------------------- |
| Infrastructure as Code | AWS CDK (TypeScript)         |
| Runtime                | ECS Fargate                  |
| Persistence            | EFS                          |
| Access                 | ALB                          |
| Security               | IAM + VPC                    |
| Optional               | HTTPS, Auto Scaling, Backups |

---


