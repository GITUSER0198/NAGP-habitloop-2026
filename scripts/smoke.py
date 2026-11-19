"""Shared public-API walkthrough for the PowerShell and POSIX launchers."""

import argparse
import hashlib
import hmac
import json
import os
import secrets
import sys
import time
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4


class Walkthrough:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = ""
        self.activity: dict[str, Any] = {}
        self.link: dict[str, Any] = {}
        self.recommendation: dict[str, Any] = {}
        self.started = datetime.now(timezone.utc)

    def call(self, method: str, path: str, body: Any = None,
             headers: dict[str, str] | None = None, expected: int = 200) -> Any:
        request_headers = {"Content-Type": "application/json", **(headers or {})}
        if self.token:
            request_headers["Authorization"] = f"Bearer {self.token}"
        data = body if isinstance(body, bytes) else None if body is None else json.dumps(body).encode("utf-8")
        request = Request(self.base_url + path, method=method, headers=request_headers, data=data)
        with urlopen(request, timeout=30) as response:
            if response.status != expected:
                raise ValueError(f"{method} {path}: expected HTTP {expected}, got {response.status}")
            return json.load(response)

    def wait_for(self, label: str, check: Callable[[], bool]) -> None:
        started = time.monotonic()
        while True:
            if check():
                return
            elapsed = time.monotonic() - started
            if elapsed >= 90:
                raise ValueError(f"Timed out: {label}")
            print(f"  {label}: elapsed {elapsed:.0f}s of 90s", flush=True)
            time.sleep(2)

    def register(self) -> None:
        suffix = uuid4().hex
        result = self.call("POST", "/api/users/register", {
            "email": f"smoke-{suffix}@example.com", "password": secrets.token_urlsafe(24),
            "name": "Smoke Walker", "tenant_name": f"Smoke {suffix}", "timezone": "UTC",
        }, expected=201)
        self.token = result["token"]
        assert self.call("GET", "/api/users/me")["id"] == result["user"]["id"]

    def create_activity(self) -> None:
        self.activity = self.call("POST", "/api/activities", {
            "name": "Walkthrough run", "category": "fitness", "frequency": "daily",
            "preferred_time": "20:00", "target_per_week": 7,
        }, expected=201)

    def log_statuses(self) -> None:
        path = f"/api/activities/{self.activity['id']}/logs"
        for index in range(6):
            day = (self.started - timedelta(days=index + 1)).replace(minute=0, second=0, microsecond=0)
            for hour, status in ((7, "completed"), (20, "missed")):
                result = self.call("POST", path, {
                    "status": status, "logged_at": day.replace(hour=hour).isoformat(),
                }, expected=201)
                assert result["status"] == status
        assert self.call("POST", path, {"status": "done"}, expected=201)["status"] == "done"
        assert len(self.call("GET", path)) == 13

    def analytics(self) -> None:
        def updated() -> bool:
            rows = self.call("GET", "/api/analytics/trend?days=7")
            return sum(row[status] for row in rows for status in ("done", "missed", "completed")) == 13
        self.wait_for("waiting for 13 analytics logs", updated)
        summary = self.call("GET", "/api/analytics/summary")
        assert 0 < summary["rate_7d"] < 1
        assert len(self.call("GET", "/api/analytics/heatmap")) == 365
        assert "overall" in self.call("GET", "/api/analytics/milestones")

    def link_integration(self) -> None:
        self.link = self.call("POST", "/api/integrations/links", {
            "provider": "mockfit", "activity_map": {"run": self.activity["id"]},
        }, expected=201)
        assert self.link["ingest_key"]

    def simulate(self) -> None:
        event_id = uuid4().hex
        body = json.dumps({"event_id": event_id, "type": "workout", "provider_activity": "run",
                           "started_at": self.started.isoformat(), "duration_min": 30,
                           "steps": 6000}, separators=(",", ":")).encode("utf-8")
        path = f"/api/integrations/ingest/{self.link['id']}"
        signature = "sha256=" + hmac.new(self.link["ingest_key"].encode("utf-8"), body, hashlib.sha256).hexdigest()
        headers = {"X-HabitLoop-Signature": signature}
        self.call("POST", path, body, headers, expected=202)
        assert self.call("POST", path, body, headers)["duplicate"] is True
        try:
            self.call("POST", path, body, {"X-HabitLoop-Signature": "sha256=invalid"})
        except HTTPError as exc:
            if exc.code != 401:
                raise
        else:
            raise ValueError("Invalid partner signature was accepted")

        def normalized() -> bool:
            events = self.call("GET", f"/api/integrations/links/{self.link['id']}/events")
            return any(row["event_id"] == event_id and row["status"] == "normalized" for row in events)
        self.wait_for("waiting for normalized partner event", normalized)
        logs = self.call("GET", f"/api/activities/{self.activity['id']}/logs")
        assert len(logs) == 14
        assert sum(row["source"] == "partner" for row in logs) == 1

    def refresh(self) -> None:
        def suggested() -> bool:
            result = self.call("POST", "/api/recommendations/refresh")
            self.recommendation = next((row for row in result["recommendations"] if row["kind"] == "timing"), {})
            return bool(self.recommendation)
        self.wait_for("waiting for timing recommendation", suggested)
        assert self.recommendation["suggested_value"]["preferred_time"] == "07:00"
        assert self.recommendation["id"] in {row["id"] for row in self.call("GET", "/api/recommendations")["recommendations"]}

    def accept(self) -> None:
        path = f"/api/recommendations/{self.recommendation['id']}/accept"
        assert self.call("POST", path)["status"] == "accepted"
        assert self.call("POST", path)["status"] == "accepted"
        activity = self.call("GET", f"/api/activities/{self.activity['id']}")
        assert activity["preferred_time"] == "07:00"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=os.environ.get("BASE_URL", "http://localhost:47810"))
    args = parser.parse_args()
    walkthrough = Walkthrough(args.base_url)
    steps = [("register", walkthrough.register), ("create activity", walkthrough.create_activity),
             ("log done/missed/completed", walkthrough.log_statuses), ("read analytics", walkthrough.analytics),
             ("link integration", walkthrough.link_integration), ("simulate signed event and replay", walkthrough.simulate),
             ("refresh recommendation", walkthrough.refresh), ("accept recommendation", walkthrough.accept)]
    for index, (label, action) in enumerate(steps, 1):
        print(f"{index} of {len(steps)}: {label}", flush=True)
        try:
            action()
        except Exception as exc:
            reason = f"HTTP {exc.code}" if isinstance(exc, HTTPError) else str(exc) or type(exc).__name__
            print(f"FAIL: {label}: {reason}", file=sys.stderr, flush=True)
            return 1
        print(f"PASS: {label}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
