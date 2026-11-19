"""Export service OpenAPI documents through the gateway and namespace their merge."""

import argparse
import copy
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.request import urlopen

SERVICES = {"user-service": "users", "activity-service": "activities",
            "challenge-service": "challenges", "integration-service": "integrations",
            "analytics-service": "analytics", "recommendation-service": "recommendations"}


def namespace(value: Any, prefix: str) -> Any:
    if isinstance(value, list):
        return [namespace(item, prefix) for item in value]
    if not isinstance(value, dict):
        return value
    result = {}
    for key, item in value.items():
        if key == "$ref" and isinstance(item, str) and item.startswith("#/components/"):
            parts = item.split("/")
            parts[3] = prefix + parts[3]
            result[key] = "/".join(parts)
        elif key == "security":
            result[key] = [{prefix + name: scopes for name, scopes in requirement.items()}
                           for requirement in item]
        elif key == "operationId":
            result[key] = prefix + item
        elif key == "mapping" and isinstance(item, dict):
            result[key] = {name: namespace({"$ref": ref}, prefix)["$ref"] for name, ref in item.items()}
        else:
            result[key] = namespace(item, prefix)
    return result


def merge(documents: dict[str, dict[str, Any]], base_url: str) -> dict[str, Any]:
    merged: dict[str, Any] = {
        "openapi": next(iter(documents.values()))["openapi"],
        "info": {"title": "HabitLoop API", "version": "1.0.0"},
        "servers": [{"url": base_url.rstrip("/")}], "paths": {}, "components": {},
    }
    for service, original in documents.items():
        if original["openapi"] != merged["openapi"]:
            raise ValueError("Cannot merge different OpenAPI versions")
        document = namespace(copy.deepcopy(original), service.replace("-", "_") + "__")
        for path, operations in document["paths"].items():
            if path in merged["paths"]:
                raise ValueError(f"Duplicate API path: {path}")
            merged["paths"][path] = operations
        for section, entries in document.get("components", {}).items():
            target = merged["components"].setdefault(section, {})
            for name, entry in entries.items():
                target[service.replace("-", "_") + "__" + name] = entry
    return merged


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=os.environ.get("BASE_URL", "http://localhost:47810"))
    args = parser.parse_args()
    output = Path(__file__).resolve().parents[2] / "docs" / "api"
    try:
        documents = {}
        for index, (service, route) in enumerate(SERVICES.items(), 1):
            print(f"{index} of {len(SERVICES)}: fetching {service}", flush=True)
            with urlopen(f"{args.base_url.rstrip('/')}/api/{route}/openapi.json", timeout=30) as response:
                documents[service] = json.load(response)
        combined = merge(documents, args.base_url)
        output.mkdir(parents=True, exist_ok=True)
        for service, document in {**documents, "habitloop": combined}.items():
            (output / f"{service}.openapi.json").write_text(
                json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n",
            )
        print("PASS: six service specifications and merged HabitLoop specification exported")
    except (OSError, ValueError, KeyError) as exc:
        print(f"FAIL: OpenAPI export: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
