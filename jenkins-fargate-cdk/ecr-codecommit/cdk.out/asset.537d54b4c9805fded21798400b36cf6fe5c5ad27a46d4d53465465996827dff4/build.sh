ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=$(aws configure get default.region)

echo "ACCOUNT_ID: $ACCOUNT_ID"
echo "REGION: $REGION"
sleep 1

docker build -t jenkins-fargate .

docker tag jenkins-fargate:latest ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/jenkins-fargate-dev:latest

aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com

docker push ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/jenkins-fargate-dev:latest

# docker run -d --name jenkins -p 9000:9000 -p 9092:9092 jenkins-fargate:latest