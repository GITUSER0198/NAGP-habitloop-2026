#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
base_url=${1:-${BASE_URL:-http://localhost:47810}}
exec "${PYTHON:-python3}" "$script_dir/smoke.py" --base-url "$base_url"
