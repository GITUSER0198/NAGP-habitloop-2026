# Local setup

Run everything from the repository root in PowerShell.

## Prerequisites

- Docker Desktop (Linux containers, Compose v2)
- Node.js 22 and npm (for the seed and smoke scripts)
- If PowerShell blocks scripts: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`

## Start

1. Create `.env` (first time only): `Copy-Item .env.example .env`
2. Build and start all containers (waits until every service is healthy):
   `./scripts/dev-up.ps1`
3. Install script dependencies: `npm ci`
4. Load demo data: `npm run seed -- --base-url http://localhost:47810`
5. Optional end-to-end check (all steps should print PASS):
   `./scripts/smoke.ps1 -BASE_URL http://localhost:47810`

## Use it

Open <http://localhost:47809>, choose **Log in** (the page opens on Register) and sign in with:

| Email | Password |
|---|---|
| `dhruv.goel@nagarro.com` (has 30 days of history) | `Demo-Pass-123` |
| `testuser1@example.com`, `testuser2@example.com`, `testuser3@example.com` | `Demo-Pass-123` |

The seed creates the communities **NAGP Demo**, **Morning Runners** and **Book Club**, with 30 days
of history for Dhruv, so the dashboard and recommendations have data straight away.

The API specifications (OpenAPI) and the Postman collection are in [docs/api](api/README.md).

## Stop

`./scripts/dev-down.ps1`

Data is kept in `data/` and is there again on the next start.

## If something goes wrong

| Problem | Fix |
|---|---|
| Docker not running | Start Docker Desktop and wait until `docker version` works. |
| A service is unhealthy | `docker compose ps`, then `docker compose logs --tail 80 <service>`. |
| `tsx` not found | Run `npm ci` at the repository root. |
| Port 47809 or 47810 in use | Another copy is running: check `docker compose ps`. |
| Services exit and the `postgres` log shows `password authentication failed` | `POSTGRES_PASSWORD` in `.env` was changed after the first start. Set the database to the new value, then run `dev-up` again: `docker compose exec postgres psql -U habitloop -d habitloop -c "ALTER USER habitloop WITH PASSWORD '<POSTGRES_PASSWORD from .env>'"` |
| Login says the password is incorrect | Choose **Log in**, not Register, and use `Demo-Pass-123`. If `DEMO_PASSWORD` was changed after seeding, the accounts keep the password they were created with. |
