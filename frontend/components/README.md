# @habitloop/components

From this folder, run `npm ci`, `npm run build`, and `npm test`.
The library is emitted to `dist/` and `loader/`. The static demo is `www/index.html`.
Serve the built demo through the project's web server on its assigned port, 47809.
No additional development server or port is required.

Load `dist/habitloop/habitloop.css` once at document level, then call
`defineCustomElements()` from `@habitloop/components/loader`. That stylesheet imports the
single theme source `../theme/tokens.css` at build time and declares the shared Tabler font.
Keep its adjacent `fonts/` files when serving the library. Toggle `data-mode="light"` on
the document root to select light mode. Omit it for Midnight dark. Tokens inherit into
every shadow root. Rebuild after editing tokens.

All nine components use props for state and bubbling, composed CustomEvents for actions.
The parent performs service requests, sets `busy` on action components while waiting, and
updates their status props when finished. These components make no requests themselves.

- `hl-activity-summary`: `name`, `category`, `preferredTime`, `status`, `streak`, `busy`.
  Emits `hlLog` with `{status}` for `done`, `completed`, or `missed`.
- `hl-challenge-card`: `title`, `visibility`, `participants`, `progress`, `target`, `joined`,
  `owner` (shows "Your challenge" instead of Join or Joined), `invited`, `busy`. Emits `hlJoin`, `hlAccept`, `hlDecline` with no payload.
- `hl-partner-tile`: `provider`, `linked`, `lastEventAt`, `rejectedCount`, `busy`.
  Emits `hlConnect`, `hlDisconnect` with no payload.
- `hl-chart`: `type` (`trend` or `bar`), `data`: numbers or `{label, value}` records.
- `hl-heatmap`: `data`: `{date, done, completed, missed}` records. Dates use `YYYY-MM-DD`.
  Shows 365 calendar days ending on the latest supplied date, with Sunday as the first row.
  Missing dates have zero counts; duplicate dates use the last supplied record.
  Intensity counts `done + completed`, normalized to four nonzero levels within that year.
  Missed-only dates remain level zero; tooltips include all three counts.
- `hl-badge`: `days`, `earned`, `earnedAt`, `remaining`.
- `hl-leaderboard`: `rows`: `{name, count, target, isMe}` records in caller-supplied order.
- `hl-reminder-banner`: `items`: `{activityId, name, dueAt}` records, `busy`.
  Emits `hlLogNow`, `hlSnooze`, each with `{activityId}`.
- `hl-recommendation-card`: `kind`, `current`, `suggested`, `reason`, `confidence` (0 to 1),
  `status`, `busy`. Emits `hlAccept`, `hlDismiss` while status is `pending`.

Array props accept JSON attribute strings or arrays assigned as JavaScript properties.
Empty, malformed, or invalid chart and heatmap data shows an empty state. Negative or
non-finite counts are invalid. Chart values are nonnegative. Times are stored as `HH:MM`
and displayed through the shared `formatTime` helper; missing schedules show "Any time".
Timestamp props use ISO 8601 and display in the browser's local timezone with AM/PM.

Give each component a stable, unique HTML `id` to persist disclosure state. Secondary
sections default closed. Storage failures are caught; components without an id do not
persist disclosure state. The demo also saves mode selection when localStorage is available.

Category names and Tabler class names come directly from `../../config/categories.json`.
The six glyph declarations use Tabler Icons 3.52.0, licensed under MIT:
https://github.com/tabler/tabler-icons/blob/main/LICENSE.
Only the three required WOFF2 chunks are copied into build outputs. The body font is the
contract's Inter/system stack; Inter is used when supplied by the host, otherwise system UI.
