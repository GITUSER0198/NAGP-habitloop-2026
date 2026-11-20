# User walkthrough

Complete the [local setup and seed](setup.md) first. The same pages work at the AWS CloudFront
URL after deployment. This journey first uses a newly registered account to demonstrate the
empty state, then switches to seeded Alex for a timing recommendation with sufficient history.
No UI form backdates logs, so a new account cannot demonstrate the timing rule from three clicks.

Save app screenshots under `docs/deployment/screenshots/` using the names below. These are
instructions for the person capturing evidence; no screenshots are supplied by this document.
Hide passwords, ingest keys, simulator command secrets, cookies and JWTs before capture.
Console evidence filenames are listed in the [deployment guide](deployment/README.md).

## 1. Register

Open `/onboarding`, choose **Register**, enter tenant name **Walkthrough Team**, your name, a
new email and a password. **Check tenant** reports whether the space exists. Choose **Create
account**. If this email was already used in the tenant, use **Log in** or a new email. Registration
joins an existing tenant when the tenant name resolves to its slug. The browser supplies your
timezone.

Expected screen: `/dashboard` with the top navigation, no activities, a **New activity** button,
empty trend/history and zero summary counts. Midnight dark is the default; the light/dark
toggle persists locally. Screenshot: `app-01-registered-dashboard.png`.

## 2. Create an activity

Choose **New activity**. Set name **Evening walk**, category **fitness**, frequency **Daily**,
preferred time **8:00 PM** and target per week **7**. Save with **Create activity**. Input also
accepts `20:00`; schedules store `HH:MM` and display AM/PM.

Expected screen: `/activities/<id>` titled **Evening walk**, the **Activity created** notice,
**Log this activity** and **Edit activity** panels. The saved preferred time is **8:00 PM**.
Screenshot: `app-02-created-activity.png`.

## 3. Record missed, done and completed

On the activity page, choose **Log missed**, wait for the saved message, then **Log done**,
wait, then **Log completed**. Expand **Log history**. These create three separate occurrences;
later clicks do not replace earlier logs. `missed` means skipped, `done` means partial progress,
and `completed` means the full target was met.

Expected screen: three rows with their status, time and `manual` source, newest first. Capture
`app-03-status-history.png`. On the dashboard, the activity card shows the latest status,
`completed`. The aggregate still includes all three occurrences.

## 4. Inspect analytics

Return to `/dashboard`. With no other logs, expect Done today **1**, Completed today **1**,
Missed today **1** and a rounded 7-day success rate of **67%**. Both `done` and `completed`
count as successes. A missed log breaks that day's streak even when another log succeeds, so
expect current streak **0** here. Inspect the trend, milestone badges and 365-day heatmap.
The All activities disclosure remembers whether you left it open.

Expected screen: **Live updates connected**, or **Polling every 10 seconds** if SSE is unavailable.
Counts refresh without a page reload. Allow time for AWS aggregation. Capture
`app-04-live-analytics.png`. Analytics buckets use UTC, so near midnight your account's local
day can differ from the analytics day. All three clicks must fall on the same UTC date for the
exact counts above.

## 5. Create and inspect a challenge

Open `/challenges`, expand **Create a challenge** and create **Walk together**: public,
category fitness, start date today, end date seven days later, target count **7**. The owner
joins automatically. Open its detail link and inspect the category, date range, target and
leaderboard. Earlier logs are not retroactively added to a newly created challenge.

Return to the activity and log **completed** once more after joining. Wait for analytics and
reopen the challenge detail. Expected screen: your leaderboard progress increases by **1**.
Capture `app-05-challenge-progress.png`. The challenge page is loaded on navigation; its
leaderboard does not itself subscribe to the dashboard stream.

Optional invitation evidence: create a private challenge and use **Invite or show code**.
An empty participant email returns an eight-character code. A second user in the same tenant
can choose **Join with code**. For a direct invitation, enter one existing same-tenant user email;
that user sees **Pending invitations**, with accept and decline actions. Invitations are in-app,
with no email delivery. A same-tenant outsider opening the private detail URL receives 404.

## 6. Send a wearable event and replay it

Open `/integrations` (Wearables in navigation). In the **mockfit** mapping form choose
**Evening walk** for `run`, leave other types unimported, then choose **Link mockfit**.
The key appears once in **Save your ingest key** and disappears on navigation.

Before leaving, copy the generated simulator command and run it in a terminal at the repository
root. On macOS use `python3` instead of `python`. It sends three workouts and replays each
exact body. For AWS append `--gateway-url` with your CloudFront HTTPS URL to that command;
the generated command otherwise targets the local gateway. Do not record the key or command.

Expected terminal: **3 accepted, 3 duplicate**, new events HTTP 202, replays HTTP 200.
Choose **Hide key**, expand **Recent events**, then **Refresh events**. Expected screen:
three distinct event IDs, initially `received` in AWS, eventually `normalized`. Capture
`app-06-normalized-events.png`. Refresh again after processing if needed.

Return to the activity's Log history. Expected screen: three new `partner` rows, not six;
the 25-minute workouts are `completed`, while the 10-minute low-step workout is `done`.
Dashboard aggregates and matching joined challenge progress update from these occurrences.
Capture `app-07-partner-log-dashboard.png` after the data arrives.

To demonstrate rejection without changing a mapping, send one event with
`--provider-activity unmapped` using the same link and key while you still have them privately.
Recent events will show `rejected` with its reason and no new activity log. A bad signature
returns 401; replay deduplication and bad signatures are also checked by smoke.

## 7. Inspect recommendation evidence

For this new account, `/recommendations` may show **needs at least 3 logs per time window**
after **Refresh suggestions**. That is expected: all these manual logs were at essentially
the same time. A timing suggestion needs at least three attempts at both the current and a
better hour, plus at least a 15-percentage-point success-rate advantage.

Log out using the user menu. Log in with tenant **NAGP Demo** (or `nagp-demo`), email
**alex@example.com** and the original `DEMO_PASSWORD` used by seed. Alex has **Morning run**
and **Read a chapter**, initially scheduled at **8:00 PM**, with 30 days of alternating
successful 7:00 AM and mostly missed 8:00 PM UTC logs. Alex is a UTC user, making the
recommendation's UTC evidence and schedule hours align.

Open `/recommendations` and choose **Refresh suggestions**. Expected screen: progress steps
**Reading your history**, **Scoring time windows**, then **Done, N suggestions**; pending cards
show current and suggested schedule, reason and confidence. Find the **Morning run** timing
card suggesting **7:00 AM** instead of **8:00 PM**. Capture `app-08-timing-suggestion.png`.
The default fresh seed has high timing confidence: Alex's two activities together supply
30 attempts in each hour window. Frequency suggestions
may also appear because they use full completions in the last 14 days.

## 8. Accept the timing suggestion

Choose **Accept suggestion** on the Morning run timing card. Expected screen: accepted status,
**New schedule: 7:00 AM**, and one fewer pending card. Expand **History** to inspect the
accepted recommendation. Capture `app-09-accepted-suggestion.png`.

Open Morning run from the dashboard or its All activities list. **Edit activity** now shows
**7:00 AM**; capture `app-10-updated-schedule.png`. Repeated accept requests are safe and return
the accepted record. To inspect a different pending recommendation without applying it, choose
**Dismiss** and find it in History. If the activity is inactive or deleted, accept returns 409
and the page displays **No longer applies**, rather than claiming a schedule update.

If a prior demonstration already accepted both seeded timing suggestions, they will not be
pending again. For another recording, edit Morning run back to **8:00 PM**, then refresh
suggestions. This intentionally resets the demo schedule while retaining its history. Do not
purge the database. If seed data has aged, its stored hour evidence still supports timing;
the last-14-day frequency result can differ.

The [eight-minute script](demo/demo-script.md) combines these screens with AWS console evidence.
