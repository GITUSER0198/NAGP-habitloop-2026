# AWS deployment and evidence

This is deliverable 7's written runbook. The owner deploys, captures the screenshots below,
exports the network PNG and records the demo. No deployment or console evidence is implied
by the presence of this guide. Architecture details are in the [root README](../../README.md)
and [network diagram](../diagrams/network-architecture.md).

## 1. Prepare tools, credentials and variables

Use Docker Desktop with Linux image builds, Node.js 22 with npm (the helper scripts are TypeScript run with `tsx`; run `npm ci` once), Git,

Start in the repo root. Authenticate using your normal AWS credential chain or configured
profile and check the intended account before provisioning:

```sh
aws sts get-caller-identity
```

These commands work in both shells. For an SSO profile, sign in using your configured profile
and set `AWS_PROFILE` in that terminal (`$env:AWS_PROFILE = 'your-profile'` in PowerShell,
`export AWS_PROFILE='your-profile'` on macOS). The deployment principal needs permission to
provision the resources and pass the scoped ECS and Lambda roles.

| Windows PowerShell | macOS |
|---|---|

Edit that private file before applying:

```hcl
region      = "ap-south-1"
name_prefix = "dg-habitloop"
alarm_email = "your-real-email@example.com"
image_tag   = "initial-build-required"
```

Replace the email with your alarm recipient; keep `image_tag` temporary until the build step.
Use a lowercase `name_prefix` of at most 20 characters. Keep the owner prefix in resource names.
The five provider tags are Project, Owner, OwnerInitials, Course and ManagedBy.
The default backend is local state. State contains generated secrets and Lambda environment
remote backend. `.env` is for Compose and is not the AWS configuration source.

## 2. Apply part 1: foundation

On a fresh environment, create the network, repositories, database, table, secrets and roles
before trying to build-push. Run from the repo root in either shell:

```sh
```

follows in part 2. If this foundation already exists, inspect its outputs and skip recreating it.
Expected outputs include `name_prefix`, `region`, `repository_urls`, subnet IDs, security group
IDs, `database_address`, `secret_arns` and `dynamodb_table_name`. ARN references are safe to
inspect; secret values are not. Check six subnets across two AZs, the NAT route and isolated
data route table before proceeding. Initial RDS creation can take several minutes.

## 3. Build-push images and Lambda ZIPs

Use the intended committed application revision in the checkout. The helper tags all seven
images with the full `git rev-parse HEAD` SHA, builds `linux/amd64`, pushes to the seven immutable
ECR repositories, then builds the esbuild bundles and packages both Node.js 22 Lambdas.

| Windows PowerShell | macOS |
|---|---|
| `./infra/scripts/build-push.ps1` | `sh infra/scripts/build-push.sh` |

Expected progress: seven image builds/pushes, then Lambda packaging. Root artifacts must be
`event-normalizer.zip` and `analytics-updater.zip`, each holding one self-contained `handler.js`
(Lambda handler `handler.handler`, runtime `nodejs22.x`). They are generated binaries, not source;
do not stage them in Git. No image repository is needed for ZIP-based Lambdas.

existing tag. The helper does not skip existing tags, so rerunning the same committed SHA or
resuming a partially pushed SHA can fail. Inspect repository state first; do not delete images
or overwrite immutable tags as an automatic workaround. A new source revision needs a new
committed SHA through the owner's normal reviewed workflow. Packaging just the ZIPs is available
with `npm run package-lambdas`.

## 4. Apply part 2: runtime

From the root, in either shell:

```sh
```

Cloud Map, custom EventBridge bus, two SQS input queues and two DLQs, two VPC-attached Lambdas,
private frontend bucket, CloudFront, log groups, dashboard, alarms and SNS email subscription.
Confirm the SNS email subscription, otherwise alarm delivery stays pending.

Wait for the ECS deployment to stabilize, all seven target groups to show healthy targets,
and CloudFront to finish deploying. API target checks use `/api/<svc>/health`; web uses
`/onboarding`. Each service starts with one task and CPU tracking can scale from 1 to 3 at
60% CPU (60-second scale-out, 120-second scale-in cooldowns). Each task is 0.25 vCPU/512 MiB.
Placement is across available app subnets, with no guarantee of one task per AZ at minimum scale.

Runtime notes to verify in the console:

- Viewer HTTPS redirects at CloudFront; origin traffic to the ALB is HTTP 80. There is no ACM
  ALB certificate in this deployment. ALB ingress is the CloudFront origin-facing prefix list
  plus the single NAT EIP `/32` needed by server-side web API calls.
- ALB listener priority 1 returns 404 for `/api/*/internal` and `/api/*/internal/*`. Six service
  rules forward both the exact API prefix and its child paths, preserving the path. The default
  action forwards to web. Backend target ports are 47820 and web is 47809.
- ECS and Lambda use app subnets without public IPs. RDS is single-AZ in the two-subnet data
  subnet group, encrypted and private. App-to-RDS uses TLS on 5432. PostgreSQL schemas/tables
  initialize at service startup, with no migration command required.
- S3 and DynamoDB gateway endpoints attach to the app route table. ECR, Secrets Manager,
  EventBridge, SQS and CloudWatch API access use HTTPS 443 through NAT; there are no interface
  endpoints for those services. AWS-managed SQS polling invokes Lambda without inbound VPC ports.
- ECS execution-role secret injection reads the RDS-managed JSON credential and app secrets.
  Bootstrap constructs an escaped database URL with `sslmode=no-verify` (TLS encryption without
  server certificate verification). Lambda secret values
  rotation so the running tasks pick up fresh credentials.

## 5. Deploy frontend assets

Run from the same checkout and application revision used to build the web image:

| Windows PowerShell | macOS |
|---|---|
| `./infra/scripts/deploy-frontend.ps1` | `sh infra/scripts/deploy-frontend.sh` |

The helper resolves the web image from the ECS service's task definition, authenticates to ECR,
and pulls that image with Docker. It copies `build/client` from a temporary container without
starting it, syncs those assets to S3, and waits for CloudFront invalidation with status/elapsed
progress. This publishes the exact asset hashes referenced by the deployed server; rebuilding
on another platform can produce different hashes. Immutable assets get one-year cache metadata,
others five minutes. It retains old asset keys so an older running server revision can still
load its assets. The temporary container and extracted files are cleaned up after the operation.
It does not deploy the Node server; server changes need new images and an apply with the new SHA.

CloudFront `/api/*`, HTML pages, form actions and SvelteKit data requests use the ALB without
caching. `/_app/*`, configured static extensions and `/robots.txt` use S3 through OAC. Do not
make the S3 bucket public or upload an SPA fallback over server routes.

## 6. Seed and smoke against AWS

Set `DEMO_PASSWORD` privately for demonstration accounts before seeding. The seed can read it
from your local gitignored `.env`; AWS account passwords are created through the public APIs,
reusing an existing seeded environment. Use the CloudFront output as the base URL, without
`/api` or a trailing route. The public ALB DNS is deliberately restricted.

| Step | Windows PowerShell | macOS |
|---|---|---|
| Seed | `npm run seed -- --base-url $awsBase` | `npm run seed -- --base-url "$aws_base"` |
| Smoke | `./infra/scripts/smoke.ps1 -BASE_URL $awsBase` | `sh infra/scripts/smoke.sh "$aws_base"` |

Expect six seed stages and all twelve smoke steps PASS, including normalized partner delivery,
replay deduplication, analytics, a repeated recommendation accept and test-community cleanup.
Perform the [UI walkthrough](../walkthrough.md) at the HTTPS CloudFront URL as well;
API smoke does not validate asset delivery or form origin handling. For the UI-generated
simulator command, append `--gateway-url` with this HTTPS base URL.

## Screenshot checklist

Save PNGs to `docs/deployment/screenshots/`, using these exact filenames. Include the resource
name and relevant settings so the evidence can be reviewed. Capture app screens using the
`app-01` through `app-10` names in the walkthrough. Keep keys, passwords, secret values and
tokens hidden. Screenshots are produced during the owner's AWS deployment task.

| File | Console screen and configuration to show |
|---|---|
| `01-vpc-subnets.png` | VPC resource map/subnets: `dg-habitloop-vpc`, CIDR `10.20.0.0/16`, six /24 subnets in two AZs, public/app/data labels |
| `02-route-tables.png` | Public default to IGW; app default to one NAT plus S3/DynamoDB endpoint routes; data table with no default route. Use additional `02-route-tables-app.png` / `02-route-tables-data.png` if needed |
| `03-nacls.png` | Three tier NACL associations; data ingress only app CIDRs on 5432 and outbound ephemeral replies; app/public return ports. Add `03-nacls-app.png` / `03-nacls-public.png` for remaining rules |
| `04-security-groups.png` | ALB CloudFront prefix list + NAT `/32` on 80; app inbound from ALB 47809/47820 and self 47820; DB from app SG 5432. Add `04-security-groups-app.png` / `04-security-groups-db.png` for chained rules |
| `05-alb-rules.png` | HTTP listener 80, priority-1 internal block, six API path rules and default web target |
| `06-target-health.png` | Seven target groups with healthy IP targets, web 47809 and APIs 47820; checks `/onboarding` and prefixed `/health`. Add `06-target-health-web.png` for the separate web group |
| `07-ecs-services.png` | Cluster seven Fargate services, desired/running tasks, stable deployment; task networking in private app subnets, no public IP |
| `08-auto-scaling.png` | Service scaling policy: min 1, max 3, target CPU 60%, cooldowns 60/120 seconds |
| `09-ecr.png` | Seven repositories, immutable Git SHA tags, scan-on-push, lifecycle keeps last five images |
| `10-rds.png` | PostgreSQL 16, `db.t4g.micro`, encryption, private access, data subnet group, single AZ, seven-day backups; hide credentials |
| `11-dynamodb.png` | Analytics table name, PK/SK, on-demand capacity, tenant-qualified sample keys and `SEEN#` item without sensitive payloads |
| `12-eventbridge-rules.png` | Custom bus with PartnerEventReceived and ActivityLogged source/type patterns and SQS targets; default-bus ECS STOPPED rule scoped to cluster |
| `13-sqs.png` | Both input queues and DLQs: SSE, visibility 720 seconds, maxReceiveCount 3, queue policy restricted to matching EventBridge rule |
| `14-lambda.png` | Both Node.js 22 x86_64 functions, 512 MiB/120 seconds, app subnets, matching SQS triggers, batch size 1 and ReportBatchItemFailures; hide environment values |
| `15-secrets-manager.png` | Secret names/ARN references and RDS-managed credential metadata; never choose Retrieve secret value |
| `16-iam-roles.png` | Per-service task roles, execution role and two Lambda roles; show scoped bus/table/queue permissions and trust policy |
| `17-cloudfront-behaviors.png` | `/api/*` and default ALB behaviors with caching disabled; `/_app/*` and static file patterns to S3; HTTPS redirect and OAC origin |
| `18-s3.png` | Static asset keys, Block Public Access, AES256 encryption, bucket policy restricted to the CloudFront distribution |
| `19-cloudwatch-dashboard.png` | `dg-habitloop-ops`: requests, p95 latency, 5xx, ECS CPU/tasks, queues/DLQs, Lambda Errors, AuthFailed and StoppedTasks |
| `20-cloudwatch-alarms.png` | Alarms for p95 >1s, combined 5xx >5, auth failures >10 and stopped tasks >0 over five minutes, input depth >100 and DLQ >0 over one minute; SNS action |
| `21-sns-subscription.png` | Alarm topic and confirmed email subscription; redact recipient if desired |
| `22-vpc-endpoints.png` | S3 and DynamoDB Gateway endpoints associated with the app route table |
| `23-cloudwatch-logs.png` | Service JSON request/tenant context, `auth_failed` filter, Lambda invocation logs and cluster STOPPED log group; show handler failure entries only if actually observed |

The editable diagram is `docs/diagrams/network-architecture.drawio`. Open it with diagrams.net
and export `docs/diagrams/network-architecture.png` for deliverable 6. Screenshot evidence should
for an observed console value.

## Troubleshooting runtime

| Symptom | Inspect |
|---|---|
| CannotPullContainerError | Exact image SHA exists in the right ECR repository; NAT egress and execution-role pull policy |
| API unhealthy | ECS log group and stopped reason, injected DB secret, TLS connection, app-to-DB SG/NACL 5432, prefixed health path |
| Web server API calls fail | Web API_BASE_URL is ALB DNS, app NAT route, ALB ingress allows that NAT EIP on 80 |
| CloudFront 403 for assets | Frontend sync ran, asset keys match server revision, OAC bucket policy and S3 origin |
| Form action or login fails | Web ORIGIN matches CloudFront HTTPS URL and dynamic behavior forwards cookies/headers without caching |
| Queue grows or DLQ receives messages | Matching Lambda role, event mapping state, Cloud Map DNS, internal token; inspect handler logs before an owner-approved redrive |
| Event stays received | Check Integration publication logs and EventBridge rule. Ingest replay does not republish an already stored event after a dispatch failure |
| Lambda Errors stays zero despite retries | Handled partial-record failures are returned as batch failures; inspect SQS/DLQ and handler logs |
| StoppedTasks alarm during rollout | Rule includes all cluster STOPPED events, including normal deployments and scale-in; examine stopped reasons |
| Alarms do not email | SNS subscription must be confirmed; inspect action ARN and alarm state |

## Teardown and cost

The owner should tear down after recording when the environment is no longer needed. Teardown
is destructive and is not part of writing these documents. Preserve required evidence and data
first. From the root, the existing helper prints a saved destroy plan and prompts with default No:

| Windows PowerShell | macOS |
|---|---|
| `./infra/scripts/destroy.ps1` | `sh infra/scripts/destroy.sh` |

Approve only after reviewing the exact resource list. Empty input, EOF and anything other than
`y` or `yes` cancel. S3 has no force-destroy: a nonempty web bucket can block teardown. The helper
does not purge assets. Any asset removal requires a separate explicit decision and review of
the keys to remove. RDS creates `dg-habitloop-db-final` and retains automated backups. A prior
snapshot with that name can block another final snapshot; resolve it through a reviewed change,
not by silently deleting it. Retained snapshots/backups and managed-secret recovery periods
should be inspected after teardown. Keep the state until resource cleanup is verified.

This dev topology pays for seven continuously running Fargate tasks, ALB, NAT and its public
IPv4 address, single-AZ RDS, log ingestion/storage, ECR and frontend storage/requests. NAT egress,
cross-AZ traffic through the shared NAT, CloudFront transfer, Lambda/SQS/EventBridge usage and
DynamoDB requests add usage charges. No free-tier or fixed-price claim is assumed. ECR lifecycle
retains five images; service/Lambda logs retain 30 days and VPC flow logs 14 days. S3 asset sync
retains older keys, and final database snapshots can continue charging after destroy. Use AWS
Billing/Cost Explorer in the chosen account for actual costs and confirm remaining resources.
