#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_root"
if [ ! -f .env ]; then
    echo 'Create .env from .env.example and set your local secrets before starting.' >&2
    exit 1
fi
echo '[1 of 3] Validating Compose configuration'
docker compose config --quiet
echo '[2 of 3] Building images. Existing containers keep running during the build.'
docker compose --progress plain build
echo '[3 of 3] Starting containers and waiting for health checks'
docker compose up -d --wait --wait-timeout 180
docker compose ps
echo 'HabitLoop is ready. Use sh scripts/dev-down.sh to stop it.'
