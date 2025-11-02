
### Execute a command using ECS Exec

Install the Session Manager plugin for the AWS CLI:

https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html#install-plugin-linux

```bash
aws ecs list-tasks --cluster devops-fargate-dev --service-name jenkins
```

```json
{
    "taskArns": [
        "arn:aws:ecs:us-east-1:123456789:task/devops-fargate-dev/ac3d5a4e7273460a80aa18264e4a8f5e"
    ]
}
```

```bash
TASK_ID=$(aws ecs list-tasks --cluster devops-fargate-dev --service-name jenkins | jq '.taskArns[0]' | cut -d '/' -f3 | cut -d '"' -f1)

aws ecs execute-command --cluster devops-fargate-dev --task $TASK_ID --container jenkins-container  --interactive --command "/bin/sh"
```

```bash
The Session Manager plugin was installed successfully. Use the AWS CLI to start a session.

Starting session with SessionId: ecs-execute-command-0dfcb1f8c2e47585a
/app # top
Mem: 1253428K used, 6610268K free, 540K shrd, 2088K buff, 827656K cached
CPU:   0% usr   0% sys   0% nic 100% idle   0% io   0% irq   0% sirq
Load average: 0.00 0.02 0.00 4/301 75
  PID  PPID USER     STAT   VSZ %VSZ CPU %CPU COMMAND
   22     8 root     S    1525m  19%   2   0% /ecs-execute-command-2daf7b7a-7ad7-457d-a33d-ca639508cfa7/ssm-agent-worker
   57    22 root     S    1518m  19%   2   0% /ecs-execute-command-2daf7b7a-7ad7-457d-a33d-ca639508cfa7/ssm-session-worker ecs-execute-command-0dfcb1f8c2e47585a
    8     0 root     S    1440m  18%   1   0% /ecs-execute-command-2daf7b7a-7ad7-457d-a33d-ca639508cfa7/amazon-ssm-agent
   14     1 root     S    32632   0%   2   0% {gunicorn} /usr/local/bin/python /usr/local/bin/gunicorn flask_api:app --bind 0.0.0.0:8080
    1     0 root     S    22976   0%   0   0% {gunicorn} /usr/local/bin/python /usr/local/bin/gunicorn flask_api:app --bind 0.0.0.0:8080
   66    57 root     S     1676   0%   0   0% /bin/sh
   74    66 root     R     1604   0%   1   0% top
/app # exit
```