# AWS deployment

HabitLoop was deployed to AWS in the `ap-south-1` (Mumbai) region. Every resource name starts
with `dg-habitloop` and carries the tags Owner = Dhruv Goel and OwnerInitials = dg. The network
layout is in the [network diagram](../diagrams/network-architecture.drawio.png).

## What was deployed

| Area | Resources |
|---|---|
| Network | VPC 10.20.0.0/16 across two availability zones, with public, app and data subnets; internet gateway; one NAT gateway; S3 and DynamoDB gateway endpoints; VPC flow logs |
| Entry | CloudFront (HTTPS only) in front of an Application Load Balancer; web assets from a private S3 bucket |
| Compute | ECS Fargate cluster with seven services (six APIs and the web server), auto scaling from 1 to 3 tasks at 60% CPU; images in seven private ECR repositories |
| Data | RDS PostgreSQL 16 (private, encrypted) and a DynamoDB on-demand table for analytics |
| Events | EventBridge custom bus, two SQS queues each with a dead-letter queue, two Node.js 22 Lambda functions |
| Security | Security groups chained CloudFront to ALB to services to database; secrets in Secrets Manager; one IAM role per service |
| Monitoring | CloudWatch dashboard, alarms emailed through SNS, one log group per service |

## How it was deployed

1. Build the seven container images and push them to ECR.
2. Package the two Lambda functions: `npm run package-lambdas`.
3. Create the AWS resources listed above.
4. Upload the web assets to S3 and refresh CloudFront.
5. Load demo data and run the end-to-end checks against the CloudFront URL:

   ```powershell
   $awsBase = 'https://<distribution>.cloudfront.net'
   npm run seed -- --base-url $awsBase
   npm run smoke -- --base-url $awsBase
   ```

   All smoke steps passed.

## Deployment screenshots

Console screenshots from the deployment in `ap-south-1`, stored in `docs/deployment/screenshots/`.
No secret values, keys or passwords are shown.

| Screenshot | What it shows |
|---|---|
| [01-vpc-resource-map.png](screenshots/01-vpc-resource-map.png) | VPC `dg-habitloop-vpc`: six subnets in two AZs (public, app, data), route tables, internet gateway, NAT gateway, S3 and DynamoDB gateway endpoints |
| [04-security-groups-alb-inbound.png](screenshots/04-security-groups-alb-inbound.png) | ALB security group: HTTP 80 only from the CloudFront prefix list and the NAT address |
| [04-security-groups-alb-outbound.png](screenshots/04-security-groups-alb-outbound.png) | ALB security group outbound: 47820 and 47809 only to the app security group |
| [04-security-groups-db.png](screenshots/04-security-groups-db.png) | DB security group: PostgreSQL 5432 only from the app security group |
| [05-alb-details.png](screenshots/05-alb-details.png) | `dg-habitloop-alb`: internet-facing application load balancer across two AZs |
| [05-alb-listeners.png](screenshots/05-alb-listeners.png) | HTTP 80 listener with 8 rules (internal block, six API paths, default to web) |
| [05-alb-network-mapping.png](screenshots/05-alb-network-mapping.png) | ALB subnets: the two public subnets |
| [07-ecs-services.png](screenshots/07-ecs-services.png) | `dg-habitloop-cluster`: seven Fargate services, each 1 of 1 tasks running, deployments completed |
| [09-ecr.png](screenshots/09-ecr.png) | Seven private repositories, immutable tags, AES-256 encryption |
| [10-rds.png](screenshots/10-rds.png) | `dg-habitloop-db`: PostgreSQL on db.t4g.micro, available, no internet access gateway, master credentials in Secrets Manager |
| [11-dynamodb-table.png](screenshots/11-dynamodb-table.png) | `dg-habitloop-analytics`: PK/SK keys, on-demand capacity, point-in-time recovery on |
| [11-dynamodb-items.png](screenshots/11-dynamodb-items.png) | Tenant-qualified aggregate items written by the analytics updater |
| [12-eventbridge-bus.png](screenshots/12-eventbridge-bus.png) | Custom event bus `dg-habitloop-bus` |
| [13-sqs.png](screenshots/13-sqs.png) | Input queues and their dead-letter queues, SSE encryption |
| [14-lambda-functions.png](screenshots/14-lambda-functions.png) | `dg-habitloop-event-normalizer` and `dg-habitloop-analytics-updater` on Node.js 22 |
| [14-lambda-trigger.png](screenshots/14-lambda-trigger.png) | SQS trigger from `dg-habitloop-partner-events` |
| [14-lambda-permissions.png](screenshots/14-lambda-permissions.png) | Execution role with scoped CloudWatch Logs permissions |
| [14-lambda-tags.png](screenshots/14-lambda-tags.png) | Owner and project tags (Owner = Dhruv Goel, OwnerInitials = dg) |
| [14-lambda-vpc.png](screenshots/14-lambda-vpc.png) | Lambda in the two private app subnets with the app security group |
| [15-secrets-manager.png](screenshots/15-secrets-manager.png) | Secret names only: RDS-managed credentials, internal token, JWT secret |
| [18-s3-block-public-access.png](screenshots/18-s3-block-public-access.png) | Web assets bucket with Block all public access on |
| [18-s3-bucket-policy.png](screenshots/18-s3-bucket-policy.png) | Bucket policy allowing only the CloudFront distribution (OAC) |
| [23-cloudwatch-logs.png](screenshots/23-cloudwatch-logs.png) | One log group per service and Lambda, plus VPC flow logs and ECS stopped-task logs |

