$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location -LiteralPath $projectRoot
try {
    if (-not (Test-Path -LiteralPath '.env')) {
        throw 'Create .env from .env.example and set your local secrets before starting.'
    }
    Write-Host '[1 of 3] Validating Compose configuration'
    docker compose config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Compose configuration validation failed.' }
    Write-Host '[2 of 3] Building images. Existing containers keep running during the build.'
    docker compose --progress plain build
    if ($LASTEXITCODE -ne 0) { throw 'Image build failed.' }
    Write-Host '[3 of 3] Starting containers and waiting for health checks'
    docker compose up -d --wait --wait-timeout 180
    if ($LASTEXITCODE -ne 0) { throw 'Startup failed. Inspect docker compose ps and docker compose logs.' }
    docker compose ps
    Write-Host 'HabitLoop is ready. Use ./scripts/dev-down.ps1 to stop it.'
} finally {
    Pop-Location
}
