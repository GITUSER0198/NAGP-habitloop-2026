"""Send signed mock workouts and optionally replay the exact same bodies."""

import argparse
import hashlib
import hmac
import json
import os
import sys
import time
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import UUID, uuid4


def positive_count(value: str) -> int:
    count = int(value)
    if count < 1:
        raise argparse.ArgumentTypeError("count must be at least 1")
    return count


def send(base_url: str, link_id: str, key: str, body: bytes) -> tuple[int, dict[str, Any]]:
    signature = "sha256=" + hmac.new(key.encode("utf-8"), body, hashlib.sha256).hexdigest()
    request = Request(
        f"{base_url.rstrip('/')}/api/integrations/ingest/{link_id}", data=body, method="POST",
        headers={"Content-Type": "application/json", "X-HabitLoop-Signature": signature},
    )
    with urlopen(request, timeout=30) as response:
        return response.status, json.load(response)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--link-id", required=True, type=UUID)
    parser.add_argument("--key", required=True, help="Ingest key returned when the link was created")
    parser.add_argument("--count", type=positive_count, default=1)
    parser.add_argument("--replay", action="store_true", help="Resend each event with the original ID and body")
    parser.add_argument("--provider-activity", default="run")
    parser.add_argument("--gateway-url", default=f"http://localhost:{os.environ.get('GATEWAY_PORT', '47810')}")
    args = parser.parse_args(argv)
    total = args.count * (2 if args.replay else 1)
    sent = accepted = duplicates = 0
    started = time.monotonic()
    try:
        for index in range(args.count):
            body = json.dumps({
                "event_id": str(uuid4()), "type": "workout",
                "started_at": datetime.now(timezone.utc).isoformat(),
                "duration_min": 25 if index % 2 == 0 else 10,
                "steps": 5500 if index % 3 == 0 else 1500,
                "provider_activity": args.provider_activity,
            }, separators=(",", ":")).encode("utf-8")
            for replay in range(2 if args.replay else 1):
                status, result = send(args.gateway_url, str(args.link_id), args.key, body)
                duplicate = result.get("duplicate") is True
                if replay and (status != 200 or not duplicate):
                    raise ValueError("Replay did not return HTTP 200 duplicate")
                if not replay and (status != 202 or duplicate):
                    raise ValueError("New event did not return HTTP 202")
                accepted += int(not duplicate)
                duplicates += int(duplicate)
                sent += 1
                print(f"{sent} of {total}: {'replay duplicate' if duplicate else 'accepted'} (HTTP {status})", flush=True)
    except (HTTPError, URLError, TimeoutError, ValueError, OSError) as exc:
        # Never print the key or signed request headers.
        reason = f"HTTP {exc.code}" if isinstance(exc, HTTPError) else type(exc).__name__
        print(f"Failed after {sent} of {total} requests: {reason}", file=sys.stderr)
        return 1
    print(f"Finished: {accepted} accepted, {duplicates} duplicate; elapsed {time.monotonic() - started:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
