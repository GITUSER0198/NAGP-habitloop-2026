# Eight-minute demo script

Target duration: **8:00**. This is the written part of deliverable 8; the owner records the video.
Use the deployed CloudFront URL, a new walkthrough user, and the seeded owner account (Dhruv Goel). Follow the
[walkthrough](../walkthrough.md) for field values and expected screens. Keep credentials and
the one-time ingest command off camera. Capture console evidence using the filenames in the
[deployment checklist](../deployment/README.md#screenshot-checklist).

the SNS subscription, and run seed and smoke against AWS. Have all console tabs open, filtered
to `dg-habitloop` in the selected region, with resource detail tabs ready. Pre-enter nonsensitive
form fields where useful; type passwords off camera. Keep CloudFront and IAM global screens
ready separately. Ensure Dhruv's Morning run is at 8:00 PM with a pending 7:00 AM suggestion;
reset that schedule and refresh if a previous run accepted it. Keep your fresh user's ingest key
privately after linking; run the copied simulator command with `--gateway-url <CloudFront URL>`
off camera. Keep screenshots of the completed configuration available if console navigation is
slow; state when showing a screenshot. Do not fabricate live metrics or claim load testing.

| Time | Screen and action | Narration / configuration to point at |
|---|---|---|
| 0:00-0:20 | App overview, then architecture diagram | "HabitLoop tracks tenant-scoped habits and challenges. Six APIs run behind an ALB; partner events and analytics use EventBridge, SQS and two Lambda handlers. The web app uses SvelteKit and Stencil." Show CloudFront, private app/data tiers and the separate recommendation path. |
| 0:20-0:45 | `/onboarding`: Register | Use Walkthrough Team, new email, Check tenant, then Create account. "The token binds this user to a tenant. The same email can exist in a different tenant." Show the empty dashboard after registration. |
| 0:45-1:10 | New activity, then detail | Create Evening walk, fitness, Daily, 8:00 PM, target 7. Point at AM/PM input and saved activity. "Schedules store HH:MM and use the account timezone for due times." |
| 1:10-1:35 | Activity detail: missed, done, completed | Wait after each log. Expand Log history to show three manual occurrences. "Done is partial progress; completed is the full target. These are separate logs, not status replacement." |
| 1:35-1:55 | Dashboard | Show the live connection, counts, trend, heatmap and milestone badges. "Analytics updates asynchronously without a reload, with a polling fallback. Both done and completed count as success. A missed day breaks a streak. Analytics buckets are UTC." |
| 1:55-2:20 | Challenges and challenge detail | Create Walk together with fitness category and current dates. Show owner participation, invite/code control and leaderboard. "Challenges are scoped to the tenant; private visibility also requires participation or invitation. New progress counts after joining." Log one additional completion if time permits, then reopen progress. |
| 2:20-2:50 | Wearables, terminal output, Recent events | Map mockfit run to Evening walk and link off camera so the key is hidden. Execute three workouts plus replay off camera, show only progress output: 3 accepted and 3 duplicate. Refresh Recent events to show normalized rows, then show partner log source. "Raw events are stored first, then normalized. Replay creates no second log." |
| 2:50-3:20 | Seeded Dhruv: Recommendations, accept, activity | Switch to dhruv.goel@nagarro.com, Refresh suggestions, show timing reason/confidence and 8:00 PM to 7:00 AM. Accept, show New schedule and activity edit time. "The deterministic rule requires three attempts in each hour and a 15-point improvement. This uses seeded history; a new account has insufficient evidence. Accept changes the actual schedule and repeated accept is safe." |
| 3:20-3:40 | VPC resource map and Subnets | `01-vpc-subnets.png`: CIDR 10.20.0.0/16, two AZs, public 0/1, app 10/11 and data 20/21 /24s. "Private tasks and Lambda ENIs use the app subnets; the data subnet group contains a single-AZ RDS instance." |
| 3:40-3:55 | Route tables and VPC endpoints | `02-route-tables*.png`, `22-vpc-endpoints.png`: public default IGW, app default one NAT, isolated data; S3 and DynamoDB Gateway endpoint routes. "Other AWS APIs use NAT. One NAT is a dev cost and availability trade-off." |
| 3:55-4:15 | NACLs and Security groups | `03-nacls*.png`, `04-security-groups*.png`: stateless ephemeral replies, DB ingress app CIDRs on 5432; SG chain ALB to app 47809/47820 to DB 5432. Point at CloudFront prefix-list ingress and NAT /32 on ALB 80. |
| 4:15-4:35 | ALB listener rules and target health | `05-alb-rules.png`, `06-target-health*.png`: priority-1 404 block for internal routes, six API rules, default web, seven healthy IP target groups. "CloudFront terminates viewer TLS; this ALB origin is HTTP 80. Web targets use 47809 and APIs 47820." |
| 4:35-4:55 | ECS services and Auto scaling | `07-ecs-services.png`, `08-auto-scaling.png`: seven Fargate services, private app networking, 0.25 vCPU/512 MiB, min 1/max 3, CPU target 60%, cooldowns 60/120 seconds. "One task per service at baseline does not mean one replica in each AZ." |
| 4:55-5:10 | ECR | `09-ecr.png`: seven repositories, immutable full Git SHA tags, scan-on-push, last-five lifecycle. "Both Lambdas are ZIP packages, so only the six APIs and web need image repositories." |
| 5:10-5:30 | RDS and DynamoDB | `10-rds.png`, `11-dynamodb.png`: PostgreSQL 16, encrypted private single-AZ db.t4g.micro, seven-day backup, separate schemas; DynamoDB on-demand with tenant-qualified PK/SK and SEEN log marker. "Aggregate writes and the dedupe marker share a transaction." |
| 5:30-5:50 | EventBridge rules | `12-eventbridge-rules.png`: custom bus, source habitloop.integration + PartnerEventReceived to partner queue, habitloop.activity + ActivityLogged to analytics queue; cluster-scoped STOPPED rule on default bus. "RecommendationAccepted is emitted but has no consumer in this build." |
| 5:50-6:10 | SQS | `13-sqs.png`: two queues and two DLQs, encryption, visibility 720 seconds and maxReceiveCount 3, matching EventBridge rule policy. "Transient record failures retry; exhausted messages go to their DLQ." |
| 6:10-6:30 | Lambda configuration and triggers | `14-lambda.png`: normalizer and updater, Node.js 22 x86_64, 512 MiB, timeout 120 seconds, app-subnet attachment, matching SQS mappings, batch size 1 and ReportBatchItemFailures. Keep environment values hidden. "Normalizer calls private APIs; updater writes DynamoDB through the endpoint." |
| 6:30-6:50 | Secrets Manager and IAM roles | `15-secrets-manager.png`, `16-iam-roles.png`: secret names only, RDS-managed credentials, execution role injection, separate task and Lambda roles with scoped resources. "JWT and internal tokens are not in images; private state and Lambda environment also contain sensitive values." |
| 6:50-7:10 | CloudFront behaviors and S3 | `17-cloudfront-behaviors.png`, `18-s3.png`: HTTPS redirect, dynamic default and /api uncached to ALB, /_app and static extensions to private S3 with OAC. Show Block Public Access and asset keys. "Server form actions run in ECS; S3 serves static assets." |
| 7:10-7:35 | CloudWatch dashboard and logs | `19-cloudwatch-dashboard.png`, `23-cloudwatch-logs.png`: ALB request/latency/5xx, ECS CPU/task counts, queue/DLQ, Lambda Errors, AuthFailed/StoppedTasks; tenant/request context and metric filters. "Handled batch failures may leave Lambda Errors at zero, so watch the queues and logs too." |
| 7:35-7:50 | CloudWatch alarms and SNS | `20-cloudwatch-alarms.png`, `21-sns-subscription.png`: p95 >1 second, combined 5xx >5, auth >10, stopped tasks >0 in five minutes; input queue >100, DLQ >0 in one minute. Show SNS action and confirmed email. "Normal deployments also emit STOPPED events." |
| 7:50-8:00 | App accepted schedule, then docs | "Manual and partner logs reach analytics; explainable suggestions change the schedule. The repository includes setup, OpenAPI/Postman, diagrams and a reviewed teardown runbook. I retain evidence before removing billed infrastructure." |

Keep each console segment to its allotted time by pointing at already-open configuration tabs.
The console section covers all checklist categories; the full screenshot set provides legible
detail where the recording is brief. If asynchronous processing runs late, show observed status
and return to it, or use a previously captured result with that fact stated explicitly. Never
show `received` and describe it as `normalized` before the event actually completes.
