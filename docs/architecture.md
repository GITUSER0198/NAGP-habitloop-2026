# HabitLoop architecture overview

System design, the six microservices and how they interact, including the Recommendation
Service. Back to the [README](../README.md).

## System architecture

Network architecture diagram: [docs/diagrams/network-architecture.drawio.png](diagrams/network-architecture.drawio.png).
Editable source: [docs/diagrams/network-architecture.drawio](diagrams/network-architecture.drawio)
(open it with diagrams.net).

Locally, Compose binds only web `47809` and gateway `47810` to loopback. Backend containers use
`47820`; databases stay on the private Compose network. Persistent local data lives under `data/`.
In AWS there are seven ECS services: the six APIs plus the SvelteKit Node server. S3 holds static
assets, while the server handles pages and form actions. Cloud Map supplies private backend DNS.

## Six services

Endpoint paths below are relative to the shown prefix. Each service also has prefixed `/health`,
`/docs`, and `/openapi.json`. Internal routes require `X-Internal-Token`, often with a user JWT,
and cannot be reached through nginx or the ALB.

| Service and prefix | Responsibility | Data store | Events in / out | Key endpoints |
|---|---|---|---|---|
| User, `/api/users` | Accounts, login, profile, communities and memberships | PostgreSQL `users` | None / none | `POST /register`, `POST /login`, `GET/PATCH /me`, `GET/POST /communities`, `GET /communities/discover`, `POST /communities/{id}/join`, `POST /communities/{id}/leave`, `POST /switch` |
| Activity, `/api/activities` | Activity schedules, manual logs and partner log deduplication | PostgreSQL `activities` | Normalizer calls internal HTTP / `ActivityLogged` | `GET/POST` prefix, `GET /today`, `GET/PATCH/DELETE /{id}`, `GET/POST /{id}/logs`, internal log and schedule routes |
| Challenge, `/api/challenges` | Community challenge feed, public or members-only visibility and participation | PostgreSQL `challenges` | None / none | `POST` prefix, `GET /feed`, `GET /public/{community_id}`, `GET /{id}`, `POST /{id}/join` and leave |
| Integration, `/api/integrations` | Provider mapping, per-link key, raw workout storage and ingest | PostgreSQL `integrations` | Normalizer updates event state over internal HTTP / `PartnerEventReceived` | `GET /providers`, `GET/POST /links`, `DELETE /links/{id}`, `GET /links/{id}/events`, `POST /ingest/{link_id}` |
| Analytics, `/api/analytics` | Read aggregates, progress, streaks, milestones and live summary | DynamoDB; no relational tables | `ActivityLogged` handled by analytics-updater Lambda / none | `GET /summary`, `/trend`, `/heatmap`, `/milestones`, `/cohorts`, `/challenges/{id}/progress`, `/stream`; internal user hours |
| Recommendation, `/api/recommendations` | Compute and persist timing/frequency suggestions; accept or dismiss | PostgreSQL `recommendations`; reads Activity and Analytics APIs | No subscription / `RecommendationAccepted` | `GET` prefix, `POST /refresh`, `POST /{id}/accept`, `POST /{id}/dismiss` |

`RecommendationAccepted` is published but has no downstream EventBridge consumer in this build.
Shared auth, database helpers, event publishing, analytics keys and logging live once in
`services/shared/node` as the npm workspace package `@habitloop/shared`.

## How the services talk to each other

Every request from the browser, phone or watch enters through CloudFront and the load balancer,
which sends it to the right service by path. Services call each other over internal HTTP routes
or publish events.

**Sign up and log in**

- Web or phone -> User Service (creates the account, joins the email-domain organization) -> returns a JWT with the active community as `tenant_id`

**Log a habit by hand**

- Web -> Activity Service (saves the log) -> EventBridge `ActivityLogged` -> SQS `activity-logged` -> analytics-updater Lambda -> DynamoDB
- Dashboard -> Analytics Service (reads DynamoDB) -> live summary back to the dashboard

**Wearable workout**

- Watch -> Integration Service (checks the HMAC signature, stores the raw event) -> EventBridge `PartnerEventReceived` -> SQS `partner-events` -> event-normalizer Lambda
- event-normalizer Lambda -> Activity Service (creates the activity log, skips duplicates by event id) -> Integration Service (marks the event normalized or rejected)
- Activity Service -> EventBridge `ActivityLogged` -> analytics-updater Lambda -> DynamoDB (same path as a manual log)

**Community challenges**

- Web or phone -> Challenge Service (feed, post, join, comment) -> User Service (internal: which communities the user belongs to)
- Activity Service -> Challenge Service (internal: active challenges for the logged category)

**Recommendations**

- Web -> Recommendation Service (Refresh) -> Activity Service (activities and recent logs) + Analytics Service (success rate by hour)
- Recommendation Service -> stores suggestions with a reason and confidence
- Web -> Recommendation Service (Accept) -> Activity Service (changes the schedule) -> EventBridge `RecommendationAccepted`

## Recommendation Service

Refresh is explicit through `POST /api/recommendations/refresh`. Inputs are the user's active
activities, user-wide hour aggregates from Analytics, and that user's Activity logs from the
last 14 days. All reads carry the tenant identity. This is deterministic scoring, with no ML
model, external inference API, or scheduled compute job.

| Rule | Evidence and output |
|---|---|
| Timing | Current and candidate hour each need at least 3 attempts. Choose the highest success rate, then most attempts, then earliest hour. Suggest the best hour if it differs from the current hour and improves success rate by at least 15 percentage points. Suggested minutes are `00`. |
| Frequency | For a daily activity with at least 3 logs in the last 14 days, count full `completed` logs. If fewer than 7, propose `max(3, completed_count // 2)` per week only if lower than the existing target. It changes `target_per_week`, not the `frequency` enum. |
| Confidence | Low below 10 attempts, medium from 10 through 29, high at 30 or more. Timing uses the smaller of the two hour-window sample counts; frequency uses log count. |

Timing successes include both `done` and `completed`. Hour evidence spans the stored history
and all the user's activities, while frequency uses the last 14 days for one activity.
Insufficient evidence can return `needs at least 3 logs per time window`; sufficient evidence
does not guarantee a suggestion. Identical pending suggestions are deduplicated, including
concurrent refreshes. Accepted and dismissed history remains available.

Repeated acceptance returns the accepted row without updating again. A dismissed suggestion
returns 409 on accept. Activity 404/409 becomes `Activity no longer applies`; the page displays
`No longer applies`. Upstream read failures return 503, and accept transport/publish failures
return 502 so the user can retry.

## Multi-tenancy

Accounts are global: sign-up takes name, email and password, login takes email and password, and
an email can register only once. Each user's organization comes from their email domain (for
example `nagarro.com`): registering with a non-public domain joins or creates it (the first user
is owner); public mail domains get none. Data is isolated by tenant id: every organization, every
community and every user's private Personal space has its own tenant id, and every row is stored
with one. A user belongs to many communities through memberships (like Facebook groups) and joins
public communities by browsing them. Organizations and Personal spaces never appear in Discover.
In this build communities are not tied to an organization: Discover lists public communities from
every organization. The JWT claim `tenant_id` is the active community; switching communities (`POST /api/users/switch`) issues a new token and the app
bar switcher replaces the session cookie. JWT claims carry `sub`, `tenant_id`, `email`, and `name`.
Resource queries use the token's tenant and, for personal resources, user. Other services need no
community logic. Foreign-tenant resource IDs return 404. A challenge belongs to the community it
was created in: `public` challenges are listed to every signed-in user (also on Discover) but
joining needs community membership first (409 "Join the community first"), and `members`
challenges are visible and joinable by community members only. DynamoDB partition keys include `TENANT#...#USER#...` or
`TENANT#...#CHALLENGE#...`. Tenant isolation is enforced by application code and covered by
service tests; it is not database row-level security or a separate AWS account per tenant.

## Idempotency and consistency

- Ingest has a unique `(link_id, event_id)` pair. Replaying a valid signed body returns
  `200 {duplicate:true}` and creates no second raw event.
- Partner Activity logs have a unique `source_event_id`, set to the Integration event row UUID.
  Normalizer retries cannot create a second partner log. Manual clicks create separate logs.
- Analytics writes `SEEN#<log_id>` conditionally in the same DynamoDB transaction as counts,
  streaks, hour evidence and progress, with revision checks for competing writers.
- SQS uses partial batch failure reporting, a 720-second visibility timeout, and DLQ redrive
  after three receives. The local worker has no durable queue or DLQ.
- Database commits and event publication have no transactional outbox. Ingest commits before
  publication, so a dispatch failure can leave a `received` row that a duplicate POST will not
  republish. Activity publishes before its commit. Accept patches the schedule before publishing
  and committing its status. These cross-system failure windows need operational reconciliation;
  deduplication alone is not an end-to-end exactly-once guarantee.

## Security

Passwords use bcrypt. JWTs use HS256 and expire in 60 minutes. The web server keeps the token in
an HttpOnly, SameSite=Lax session cookie, Secure on HTTPS, and forwards bearer tokens to APIs.
Partner calls authenticate the exact raw body with `X-HabitLoop-Signature: sha256=<hex>`;
the ingest key is shown only on link creation and stored hashed. Internal calls use a shared
secret and public routing blocks `/api/*/internal` before other paths.

AWS tasks have separate IAM task roles and a shared execution role for image pulls, logs, and
secret injection. Secrets Manager supplies the RDS-managed database credential, JWT secret and
internal token. Lambda secrets also appear in encrypted Lambda environment values and private
configuration. Keep `.env` out of version control. Do not show
secret values, cookies or the one-time ingest key in screenshots or recordings.

CloudFront terminates viewer TLS; its ALB origin uses HTTP 80. The ALB security group admits
CloudFront origin-facing IPs and the app NAT address for server-side API calls. ECS and Lambda
have no public IPs, RDS is private and encrypted, and RDS connections require TLS. The S3 bucket
blocks public access and permits CloudFront OAC reads. JSON service logs include request and
tenant context; CloudWatch aggregates metrics and sends alarms through SNS.

## Trade-offs and current limits

- Two AZs provide subnet placement for ECS and Lambda. A single NAT and single-AZ RDS reduce  
dev cost; neither provides full multi-AZ availability. One desired task per service may be in  
either app subnet; the diagram does not imply one replica in each AZ.
- Analytics day and hour buckets are UTC. Activity due times use the account timezone and  
schedules store `HH:MM`, displayed as AM/PM. The timing rule compares UTC evidence to stored  
schedule hours without timezone conversion, so non-UTC suggestions need careful interpretation.
- `missed` breaks a calendar streak even if another log succeeds that day. Missing calendar days  
also break streaks. `done` and `completed` both count as analytics successes and challenge progress.
- Cohort API groups the user's logs by event week. Signup-week and challenge-cohort segmentation  
are not implemented. The cohort UI flag is off by default.
- SSE is implemented by polling DynamoDB every 3 seconds and proxying the stream through web.  
Browser polling fallback is every 10 seconds. This favors simplicity over push fan-out.
