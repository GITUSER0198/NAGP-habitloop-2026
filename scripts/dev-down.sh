#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_root"
echo '[1 of 1] Stopping HabitLoop containers. Project data is retained.'
docker compose down
echo 'HabitLoop stopped.'
