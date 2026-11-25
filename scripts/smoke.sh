#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
base_url=${1:-${BASE_URL:-http://localhost:47810}}
exec npm --prefix "$project_root" run smoke --silent -- --base-url "$base_url"
