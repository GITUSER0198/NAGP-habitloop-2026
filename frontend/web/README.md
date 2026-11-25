# HabitLoop web

SvelteKit 2, Svelte 5 runes and adapter-node. Requires Node 22 or newer.

From the repository root, start the existing Compose stack. In this folder, run
`npm start` to build the web image and start it detached. It waits for a healthy
container and prints its URL. `npm stop` stops only the web container. Existing
backend containers stay running. Logs use Compose's bounded log rotation.
`start.bat` and `stop.bat` wrap those commands.

For local development, build the shared components once with `npm ci` and
`npm run build` in `../components`, then run `npm ci` here. Set `API_BASE_URL` to
the gateway's URL and `JWT_SECRET` to the same secret as the services. Run
`npm run dev`; the host port comes from the repository `.env` (`WEB_PORT`).
The Docker build includes the components and theme automatically.

Validation: `npm run check`, `npm run build`, `npm test`, then `npm run test:server`.
Server checks exercise the built modules with analytics unavailable and expired tokens.
Browser acceptance uses
`tests/walkthrough.mjs` with `PLAYWRIGHT_MODULE` pointing to an existing Playwright
module and `WEB_URL` / `GATEWAY_URL` pointing to the running Compose endpoints.
It creates separate test tenants and activities without deleting existing data.

The server verifies the JWT and forwards its cookie token to the gateway. The
browser never receives the token in page data or URLs. SSE is proxied without
buffering and falls back to polling every 10 seconds. A live summary event also
refreshes today, trend, heatmap and milestones, including wearable changes.
Analytics failures leave activities available and mark analytics panels unavailable.

Feature flags and navigation live in `src/lib/config`. Task 10 supplies the
challenges, wearables and recommendations pages referenced by the contracted nav.
Reminder snoozes are scoped by tenant and user in localStorage. No app data is
written to the user profile. Shared service data remains in the root `data/` folder.
