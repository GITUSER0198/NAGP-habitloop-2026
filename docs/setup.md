# Local setup

Run commands from the root of a fresh checkout of HabitLoop. Choose the column for your OS and
keep the same terminal for the sequence. Paths below are relative and work even when the checkout
path contains spaces. Do not change the two registered host ports.

## Prerequisites

- Docker Desktop, running with Linux containers and Docker Compose v2 supporting `up --wait`.
- Node.js 22 and npm to run the seed, smoke and wearable simulator scripts (TypeScript, run with
  `tsx` through npm), the backend tests (`npm ci`, `npm run typecheck`, `npm test` at the root),
  frontend development and AWS asset deployment. Run `npm ci` once at the root before the first
  script. Compose itself builds every service with Node 22 inside containers, independent of host
  runtimes.
- Git to obtain the checkout. Allow Docker enough memory for PostgreSQL, DynamoDB Local,
  six APIs, event-worker, gateway and web. Initial image pulls/builds need internet access.
- Windows PowerShell 5.1 or newer. If script execution is restricted, use a process-scoped
  policy for this terminal as shown below. macOS uses its normal shell and `sh` helpers.

| Check | Windows PowerShell | macOS |
|---|---|---|
| Engine | `docker version` | `docker version` |
| Compose | `docker compose version` | `docker compose version` |
| Node | `node --version` | `node --version` |
| npm | `npm.cmd --version` | `npm --version` |
| Scripts, Windows only if restricted | `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` | No change needed |

## Configure and start

Copy `.env` only on a new checkout, before the first startup. The next command replaces the
three local secret placeholders with generated, URL-safe values. It leaves the registered ports,
local AWS mode and demo password setting intact. Do not copy these local secrets into AWS.

| Step | Windows PowerShell | macOS |
|---|---|---|
| Copy defaults | `Copy-Item -LiteralPath .env.example -Destination .env` | `cp .env.example .env` |
| Generate local secrets | `node -e "const fs=require('fs'),c=require('crypto');const u=n=>c.randomBytes(n).toString('base64url');let s=fs.readFileSync('.env','utf8');s=s.replace('change-me-local-jwt',u(32)).replace('change-me-local-internal',u(32)).replace('change-me-local',u(24));fs.writeFileSync('.env',s)"` | `node -e "const fs=require('fs'),c=require('crypto');const u=n=>c.randomBytes(n).toString('base64url');let s=fs.readFileSync('.env','utf8');s=s.replace('change-me-local-jwt',u(32)).replace('change-me-local-internal',u(32)).replace('change-me-local',u(24));fs.writeFileSync('.env',s)"` |
| Validate without printing secrets | `docker compose config --quiet` | `docker compose config --quiet` |
| Build and start | `./infra/scripts/dev-up.ps1` | `sh infra/scripts/dev-up.sh` |
| Inspect state | `docker compose ps` | `docker compose ps` |

`.env` defines `WEB_PORT=47809`, `GATEWAY_PORT=47810`, `POSTGRES_USER`, `POSTGRES_PASSWORD`,
`POSTGRES_DB`, `JWT_SECRET`, `INTERNAL_TOKEN`, `EVENT_BUS_MODE=local`, `AWS_REGION`,
`DYNAMODB_TABLE=habitloop-analytics`, `LOG_LEVEL` and `DEMO_PASSWORD`. Keep local mode for Compose.
Compose supplies service URLs, schema names, dummy DynamoDB Local credentials and the local
DynamoDB endpoint internally. `.env` is gitignored. Do not rotate the PostgreSQL password by
editing `.env` on an existing data directory; the stored database password is already initialized.

`dev-up` reports three stages: validate, build images while existing containers run, then start
and wait for health checks (180-second startup timeout). Completion prints the container table.
The long-running containers should be healthy. `dynamodb-init` is a one-shot initializer and
should exit successfully with code 0. SQL schemas are created by their services at startup.

## Seed and smoke

| Step | Windows PowerShell | macOS |
|---|---|---|
| Install script dependencies, first time only | `npm ci` | `npm ci` |
| Seed demo communities and history | `npm run seed -- --base-url http://localhost:47810` | `npm run seed -- --base-url http://localhost:47810` |
| Run end-to-end checks | `./infra/scripts/smoke.ps1 -BASE_URL http://localhost:47810` | `sh infra/scripts/smoke.sh http://localhost:47810` |

Seed prints six stages, including progress through the historical logs and waiting for timing
suggestions. It creates the public communities **NAGP Demo** (owner Dhruv, all test users join),
**Morning Runners** (owner Test User 1, Test User 2 joins) and **Book Club** (owner Test User 3),
the owner account **dhruv.goel@nagarro.com** and dummy users **testuser1@example.com**,
**testuser2@example.com** and **testuser3@example.com**. The activities, history, two challenges
and mockfit mapping live in NAGP Demo, which is Dhruv's last active community, so Discover
shows the other two. Every account also has a private Personal space. Login uses the
`DEMO_PASSWORD` from `.env`; `.env.example` contains the local demonstration default. The seed
reads that setting from environment first, then `.env`. Changing it after seeding does not change
existing users' passwords. Repeated seed runs reuse named records and historical timestamps.
An old ended challenge is not renewed automatically. The seed-created link's one-time key is
not printed; use the fresh-link flow in the walkthrough for the simulator.

Smoke registers a fresh user and creates a separate randomly named community on each run. Expect
**11 of 11 steps with PASS**: registration (name, email, password only), community creation, activity,
a second user who cannot read the community's data until it joins, status logs, analytics, integration link, signed workout and replay,
recommendation refresh, repeated accept, and deleting its test community so it never appears under Discover. It checks bad HMAC rejection, one partner log,
365 heatmap rows and a schedule change to `07:00`. Analytics waits are bounded to 90 seconds.
Smoke leaves its records for inspection and does not delete data.

## URLs

Open [HabitLoop](http://localhost:47809) in the browser. Use `localhost` consistently for login
and form actions because the configured web origin is `http://localhost:47809`.

| Page or service | URL |
|---|---|
| Register or login | <http://localhost:47809/onboarding> |
| Communities (create, browse, join, switch) | <http://localhost:47809/communities> |
| Dashboard | <http://localhost:47809/dashboard> |
| Challenges | <http://localhost:47809/challenges> |
| Wearables | <http://localhost:47809/integrations> |
| Recommendations | <http://localhost:47809/recommendations> |
| User Swagger | <http://localhost:47810/api/users/docs> |
| Activity Swagger | <http://localhost:47810/api/activities/docs> |
| Challenge Swagger | <http://localhost:47810/api/challenges/docs> |
| Integration Swagger | <http://localhost:47810/api/integrations/docs> |
| Analytics Swagger | <http://localhost:47810/api/analytics/docs> |
| Recommendation Swagger | <http://localhost:47810/api/recommendations/docs> |

The Swagger pattern is `http://localhost:47810/api/<svc>/docs`, where `<svc>` is one of the
plural path names above. `/health` at the gateway is a routing health check. Each service also
has `/api/<svc>/health`. Protected endpoints need **Authorize** with a JWT obtained from register
or login. See the [API guide](api/README.md) for exported schemas and Postman.

## Stop and resume

Run the stop command only when you intend to stop HabitLoop. It retains `data/postgres/` and
`data/dynamodb/` in the project. Do not delete these directories or Docker data to troubleshoot.

| Action | Windows PowerShell | macOS |
|---|---|---|
| Stop | `./infra/scripts/dev-down.ps1` | `sh infra/scripts/dev-down.sh` |
| Resume, building before replacing containers | `./infra/scripts/dev-up.ps1` | `sh infra/scripts/dev-up.sh` |

## Troubleshooting

| Symptom | Diagnosis and next action |
|---|---|
| Docker server unavailable | Open Docker Desktop and wait for the Linux engine. Repeat `docker version`. |
| PowerShell says scripts are disabled | Use the process-scoped execution-policy command in prerequisites in that terminal. |
| `tsx` not found or modules missing | Run `npm ci` at the repo root with Node 22 on PATH, then repeat the `npm run` command. |
| Port already allocated | Inspect `docker compose ps`. Reuse an existing HabitLoop instance or identify the other listener; do not change registered ports or stop another app blindly. |
| Required variable missing | Check `.env` exists at the repo root and contains nonempty values. Use `docker compose config --quiet`; avoid printing expanded secrets. |
| Startup timeout or unhealthy service | Run `docker compose ps` and `docker compose logs --tail 80`. Identify the failing service; image pulls/build time is separate from the health wait. |
| PostgreSQL authentication failure after editing secrets | Restore the matching original `.env` credential for this data directory. Password environment values only initialize an empty database. |
| DynamoDB initializer fails | Inspect `docker compose logs --tail 80 dynamodb-local dynamodb-init`; check Docker file-sharing access to the checkout and writable `data/`. |
| Seed says login failed | Check `DEMO_PASSWORD` against the original seed value. Existing account passwords are not overwritten. |
| No recommendation for new user | Three clicks at one time are insufficient timing evidence. Use the seeded Dhruv Goel history as described in the walkthrough. |
| Analytics delayed | Inspect `docker compose logs --tail 80 event-worker activity-service analytics-service`. Confirm `EVENT_BUS_MODE=local`; wait for SSE or the 10-second fallback. |
| Partner event rejected | Expand Recent events and inspect the reason. Confirm provider activity mapping and active activity. The one-time key requires creating a link you control. |
| Session expired or form origin rejected | Log in again after the 60-minute expiry. Use the exact localhost web URL, not the gateway or an alternate hostname. |

Next: [walkthrough](walkthrough.md), [architecture](../README.md), and
[AWS deployment](deployment/README.md).
