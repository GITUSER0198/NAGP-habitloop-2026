# HabitLoop API files

The API is documented with OpenAPI 3 specifications and a Postman collection, all in this folder:

| Service | OpenAPI specification |
|---|---|
| All services combined | [habitloop.openapi.json](habitloop.openapi.json) |
| User Service | [user-service.openapi.json](user-service.openapi.json) |
| Activity Service | [activity-service.openapi.json](activity-service.openapi.json) |
| Challenge Service | [challenge-service.openapi.json](challenge-service.openapi.json) |
| Integration Service | [integration-service.openapi.json](integration-service.openapi.json) |
| Analytics Service | [analytics-service.openapi.json](analytics-service.openapi.json) |
| Recommendation Service | [recommendation-service.openapi.json](recommendation-service.openapi.json) |
| Postman collection | [HabitLoop.postman_collection.json](HabitLoop.postman_collection.json) with [HabitLoop.local.postman_environment.json](HabitLoop.local.postman_environment.json) |

Open any specification in [Swagger Editor](https://editor.swagger.io) (File, Import file) to browse
it. A running service also serves its Swagger UI at `/api/<service>/docs`.

Internal service-to-service endpoints are blocked at the gateway and are not part of the public
specifications or the collection.

## Demo and smoke walkthrough

With Node.js 22 and `npm ci` done once, run from the repository root:

```sh
npm run seed -- --base-url http://localhost:47810
npm run seed -- --base-url http://localhost:47810
```

The seed uses public APIs only. It creates the public communities `NAGP Demo`, `Morning Runners` and `Book Club`,
`dhruv.goel@nagarro.com` (Dhruv Goel) and the dummy users `testuser1@example.com`, `testuser2@example.com` and `testuser3@example.com`. `DEMO_PASSWORD`
comes from the process environment, then `.env`, then the demo value in `.env.example`.
Use that value to sign in. Existing accounts must have the same password.

Dhruv Goel owns Morning run and Read a chapter; Test User 1 owns Park walk; Test Users 2 and 3
own Evening stretch. The seed creates 30 historical logs for the first three activities and a
few completions for Test Users 2 and 3, a public movement challenge joined by all three test
users, a members-only reading challenge (Reading circle) joined by Test User 1, and one mockfit
link for Dhruv's run. Morning logs
succeed consistently, while evening logs are mostly missed. Both profiles use UTC to make
the stored history and aggregate hours reproducible. The run starts scheduled for 8:00 PM
and gets a timing suggestion for 7:00 AM. The seed leaves suggestions pending for the demo.

Reruns reuse users, activities, challenges and links. History is anchored to the public
challenge's stored start date, and existing log timestamps are skipped. Interrupted runs
can resume. An old challenge is reused after its end date without attempting new joins.
The seed does not overwrite schedules or retain the one-time ingest key. To send your own
partner events, create a new link in the app or collection and keep its returned key.

Run the complete smoke walkthrough with either launcher:

```powershell
./scripts/smoke.ps1
./scripts/smoke.ps1 -BASE_URL https://your-gateway.example.com
```

Both launchers run `npm run smoke` (`tools/smoke/src/smoke.ts`) with the same checks. They also
accept the `BASE_URL` environment variable. Seeding, smoking and exporting need only Node.js 22
and `npm ci`. Every smoke run creates a
unique community and retains its records for inspection. Each step prints PASS or
FAIL; failures exit nonzero. Analytics and partner normalization are polled for up to
90 seconds with elapsed progress. The walkthrough covers all log statuses, analytics,
HMAC partner ingest, replay deduplication, invalid signature rejection, recommendation
refresh and repeated acceptance with a verified schedule update.

## OpenAPI export and validation

```sh
npm run export-openapi
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
3. In **User Service**, send **Login** (email and password only). It stores the bearer token in
   the collection's `token` variable for your last active community. Protected requests inherit
   collection authentication. Register also saves its token (for your Personal space). **My
   Communities**, **Discover Communities**, **Create Community**, **Join Community**, **Leave
   Community** and **Switch Community** manage memberships; the last four save a new token, and
   Create Community also saves `community_id`.
4. Browse the folders for all six services. Activity and challenge creation save
   `activity_id` and `challenge_id`. Set those collection variables to existing demo IDs
   when inspecting seeded records. Adjust `challenge_start_date`, `challenge_end_date`
   and `started_at` in the environment for your walkthrough dates. Challenge visibility is `public` or `members`.
5. Creating a link saves `link_id` and its one-time `ingest_key`. The ingest request signs
   its exact body in a pre-request script using Postman's Web Crypto support
   ([sandbox reference](https://learning.postman.com/v11/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-require)). Set `event_id`
   to a new value for a new event; reuse the same body and ID to exercise replay detection.
   **Update Activity Mapping** changes which activity each workout type logs to, **Wearable Stats**
   returns per-day steps, workouts and heart rate, and **Delete Workout** removes a workout
   everywhere; set `partner_event_id` to an `id` from **List Events** first.
6. In **Recommendation Service**, refresh suggestions, list pending/accepted/dismissed,
   accept or dismiss. Refresh saves the first pending timing suggestion as
   `recommendation_id`, falling back to the first suggestion. The seeded demo supplies
   the required history; newly registered accounts need history before suggestions appear.
