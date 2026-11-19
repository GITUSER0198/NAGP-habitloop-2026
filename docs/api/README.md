# HabitLoop API files

Start the local stack with `docker compose up -d --build` from the repository root.
The gateway defaults to `http://localhost:47810`. Public documentation is available at:

| Service | Swagger UI | Exported specification |
|---|---|---|
| Users | <http://localhost:47810/api/users/docs> | `user-service.openapi.json` |
| Activities | <http://localhost:47810/api/activities/docs> | `activity-service.openapi.json` |
| Challenges | <http://localhost:47810/api/challenges/docs> | `challenge-service.openapi.json` |
| Integrations | <http://localhost:47810/api/integrations/docs> | `integration-service.openapi.json` |
| Analytics | <http://localhost:47810/api/analytics/docs> | `analytics-service.openapi.json` |
| Recommendations | <http://localhost:47810/api/recommendations/docs> | `recommendation-service.openapi.json` |

Each UI reads `/api/<service-route>/openapi.json` through the gateway. Internal endpoints
require both service authentication and a tenant bearer token and are blocked at the gateway.
They are excluded from the public specifications and collection.

## Demo and smoke walkthrough

With Python 3.12 or newer, run from the repository root:

```sh
python tools/seed/seed.py
python tools/seed/seed.py
```

The seed uses public APIs only. It creates the `NAGP Demo` tenant (slug `nagp-demo`),
`alex@example.com` (Alex Morgan) and `sam@example.com` (Sam Patel). `DEMO_PASSWORD`
comes from the process environment, then `.env`, then the demo value in `.env.example`.
Use that value to sign in. Existing accounts must have the same password.

Alex owns Morning run and Read a chapter; Sam owns Park walk. The seed creates exactly
30 historical logs per activity, a public movement challenge joined by Sam, a private
reading challenge with Sam invited, and one mockfit link for Alex's run. Morning logs
succeed consistently, while evening logs are mostly missed. Both profiles use UTC to make
the stored history and aggregate hours reproducible. The run starts scheduled for 8:00 PM
and gets a timing suggestion for 7:00 AM. The seed leaves suggestions pending for the demo.

Reruns reuse users, activities, challenges and links. History is anchored to the public
challenge's stored start date, and existing log timestamps are skipped. Interrupted runs
can resume. An old challenge is reused after its end date without attempting new invitations.
The seed does not overwrite schedules or retain the one-time ingest key. To send your own
partner events, create a new link in the app or collection and keep its returned key.

Run the complete smoke walkthrough with either launcher:

```powershell
./infra/scripts/smoke.ps1
./infra/scripts/smoke.ps1 -BASE_URL https://your-gateway.example.com
```

```sh
sh infra/scripts/smoke.sh
sh infra/scripts/smoke.sh https://your-gateway.example.com
```

Both launchers run `infra/scripts/smoke.py` with the same checks. They also accept the
`BASE_URL` environment variable and `PYTHON` to select a Python executable. No third-party
Python packages are needed for seeding, smoking or exporting. Every smoke run creates a
unique isolated tenant and retains its records for inspection. Each step prints PASS or
FAIL; failures exit nonzero. Analytics and partner normalization are polled for up to
90 seconds with elapsed progress. The walkthrough covers all log statuses, analytics,
HMAC partner ingest, replay deduplication, invalid signature rejection, recommendation
refresh and repeated acceptance with a verified schedule update.

## OpenAPI export and validation

```sh
python infra/scripts/export-openapi.py
python -m pip install -r infra/scripts/requirements-test.txt
python -m openapi_spec_validator docs/api/habitloop.openapi.json
```

The exporter fetches all six service documents through the gateway before writing any
files. `habitloop.openapi.json` combines the public routes with namespaced components,
security schemes and operation IDs so identically named service models stay distinct.
Run the exporter again after API changes. For AWS, set `BASE_URL` or pass
`--base-url https://your-gateway.example.com`; the merged server URL follows that value.

## Postman

1. Import `HabitLoop.postman_collection.json` and `HabitLoop.local.postman_environment.json`.
2. Select the **HabitLoop local** environment. Set `password` to your `DEMO_PASSWORD` value.
   Set `base_url` to the gateway URL for local or AWS use.
3. In **User Service**, send **Login**. It stores the bearer token in the collection's
   `token` variable. Protected requests inherit collection authentication. Register also
   saves its token, and uses the environment email, name and tenant name.
4. Browse the folders for all six services. Activity and challenge creation save
   `activity_id` and `challenge_id`. Set those collection variables to existing demo IDs
   when inspecting seeded records. Adjust `challenge_start_date`, `challenge_end_date`
   and `started_at` in the environment for your walkthrough dates. Invites accept `emails`, with no invitation saved if
   any address is unknown in the tenant.
5. Creating a link saves `link_id` and its one-time `ingest_key`. The ingest request signs
   its exact body in a pre-request script using Postman's Web Crypto support
   ([sandbox reference](https://learning.postman.com/v11/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-require)). Set `event_id`
   to a new value for a new event; reuse the same body and ID to exercise replay detection.
6. In **Recommendation Service**, refresh suggestions, list pending/accepted/dismissed,
   accept or dismiss. Refresh saves the first pending timing suggestion as
   `recommendation_id`, falling back to the first suggestion. The seeded demo supplies
   the required history; newly registered accounts need history before suggestions appear.

Delete and dismiss requests change the selected demo resources. Run those individually
when desired. The analytics stream is a long-lived SSE response; stop it manually in
Postman after inspecting an event. Exported environment and collection files contain no
live tokens or ingest keys; keep local credential values private.
