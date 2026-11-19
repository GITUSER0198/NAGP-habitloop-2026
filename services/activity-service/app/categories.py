"""Read the category configuration shared with the web app."""

import json
from pathlib import Path


def load_categories() -> dict[str, str]:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "config" / "categories.json"
        if candidate.is_file():
            with candidate.open(encoding="utf-8") as stream:
                return json.load(stream)
    raise RuntimeError("config/categories.json is required")
