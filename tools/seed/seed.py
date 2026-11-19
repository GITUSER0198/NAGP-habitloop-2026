"""Seed the demo through public gateway APIs. Existing demo records are reused."""

import argparse
import json
import os
import sys
import time
from datetime import date, datetime, time as day_time, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]


def setting(name: str) -> str:
    if name in os.environ:
        return os.environ[name]
    for filename in (".env", ".env.example"):
        path = ROOT / filename
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                key, separator, value = line.partition("=")
                if separator and key.strip() == name:
                    return value.strip().strip("\"'")
    raise ValueError(f"Set {name} in the environment or .env")


class API:
    def __init__(self, base_url: str, token: str = "") -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token

    def call(self, method: str, path: str, body: Any = None) -> Any:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = Request(self.base_url + path, method=method, headers=headers,
                          data=None if body is None else json.dumps(body).encode("utf-8"))
        with urlopen(request, timeout=30) as response:
            return json.load(response)


def account(base_url: str, email: str, name: str, password: str) -> API:
    api = API(base_url)
    try:
        result = api.call("POST", "/api/users/register", {
            "email": email, "name": name, "password": password,
            "tenant_name": "NAGP Demo", "timezone": "UTC",
        })
    except HTTPError as exc:
        if exc.code != 409:
            raise
        result = api.call("POST", "/api/users/login", {
            "email": email, "password": password, "tenant_slug": "nagp-demo",
        })
    api.token = result["token"]
    return api


def seed(base_url: str) -> None:
    password = setting("DEMO_PASSWORD")
    alex = account(base_url, "alex@example.com", "Alex Morgan", password)
    sam = account(base_url, "sam@example.com", "Sam Patel", password)
    print("1 of 6: demo tenant and two users ready", flush=True)
    activities: list[tuple[API, dict[str, Any], int]] = []
    for api, name, category, hour in (
        (alex, "Morning run", "fitness", 20),
        (alex, "Read a chapter", "learning", 20),
        (sam, "Park walk", "fitness", 7),
    ):
        existing = api.call("GET", "/api/activities")
        activity = next((row for row in existing if row["name"] == name), None)
        if activity is None:
            activity = api.call("POST", "/api/activities", {
                "name": name, "category": category, "frequency": "daily",
                "preferred_time": f"{hour:02d}:00", "target_per_week": 7,
            })
        activities.append((api, activity, hour))
    print("2 of 6: three activities ready", flush=True)
    feed = alex.call("GET", "/api/challenges/feed")
    challenges = []
    for title, visibility, category in (
        ("NAGP 30-day movement", "public", "fitness"),
        ("Alex and Sam reading circle", "private", "learning"),
    ):
        challenge = next((row for row in feed if row["title"] == title), None)
        if challenge is None:
            today = datetime.now(timezone.utc).date()
            challenge = alex.call("POST", "/api/challenges", {
                "title": title, "visibility": visibility, "activity_category": category,
                "description": "Small daily steps, shared encouragement, lasting habits.",
                "start_date": (today - timedelta(days=30)).isoformat(),
                "end_date": (today + timedelta(days=30)).isoformat(), "target_count": 30,
            })
        challenges.append(challenge)
    # Do not mutate an ended challenge when reusing an older demo.
    if date.fromisoformat(challenges[0]["end_date"]) >= datetime.now(timezone.utc).date():
        sam.call("POST", f"/api/challenges/{challenges[0]['id']}/join")
    if date.fromisoformat(challenges[1]["end_date"]) >= datetime.now(timezone.utc).date():
        alex.call("POST", f"/api/challenges/{challenges[1]['id']}/invites", {"emails": ["sam@example.com"]})
    print("3 of 6: public and private challenges ready", flush=True)
    # A stored challenge date anchors the dataset across reruns and interrupted runs.
    anchor = date.fromisoformat(challenges[0]["start_date"])
    added = 0
    for activity_index, (api, activity, _) in enumerate(activities):
        path = f"/api/activities/{activity['id']}/logs"
        existing_times = {datetime.fromisoformat(row["logged_at"].replace("Z", "+00:00"))
                          for row in api.call("GET", path)}
        for index in range(30):
            morning = index % 2 == 0 or activity["name"] == "Park walk"
            hour = 7 if morning else 20
            stamp = datetime.combine(anchor + timedelta(days=index), day_time(hour), timezone.utc)
            status = "completed" if morning else "done" if index % 5 == 0 else "missed"
            if stamp not in existing_times:
                api.call("POST", path, {"status": status, "logged_at": stamp.isoformat(),
                                        "duration_min": 25 if status == "completed" else 5})
                added += 1
            print(f"4 of 6: history {activity_index * 30 + index + 1} of 90", flush=True)
    print(f"4 of 6: 30 days ready, {added} logs added", flush=True)
    links = alex.call("GET", "/api/integrations/links")
    if not any(row["provider"] == "mockfit" and row["activity_map"].get("run") == activities[0][1]["id"]
               for row in links):
        alex.call("POST", "/api/integrations/links", {
            "provider": "mockfit", "activity_map": {"run": activities[0][1]["id"]},
        })
    print("5 of 6: mockfit link ready", flush=True)
    deadline = time.monotonic() + 90
    while True:
        result = alex.call("POST", "/api/recommendations/refresh")
        timing = [row for row in result["recommendations"] if row["kind"] == "timing"]
        if timing:
            break
        if all(row["preferred_time"] == "07:00" for _, row, _ in activities[:2]):
            print("6 of 6: morning schedules already applied", flush=True)
            return
        if time.monotonic() >= deadline:
            raise ValueError("Timed out waiting for a timing suggestion from seeded analytics")
        print("6 of 6: waiting for analytics and timing suggestion", flush=True)
        time.sleep(2)
    print(f"6 of 6: {len(timing)} timing suggestions ready. Demo finished.", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=os.environ.get("BASE_URL", "http://localhost:47810"))
    args = parser.parse_args()
    try:
        seed(args.base_url)
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, KeyError) as exc:
        reason = f"HTTP {exc.code}" if isinstance(exc, HTTPError) else str(exc)
        print(f"FAIL: seed: {reason}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
