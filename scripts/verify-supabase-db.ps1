<#
.SYNOPSIS
  LIFTED Phase 6: Automated Local Supabase Database & pgTAP Verification Script
.DESCRIPTION
  Runs the disposable local Supabase PostgreSQL container, applies migrations,
  executes pgTAP security test suites, and verifies Row Level Security (RLS) enforcement.
.REQUIREMENTS
  - Docker Desktop or Podman running on host
  - Node.js & npm (npx supabase CLI)
#>

$ErrorActionPreference = "Stop"

Write-Host "=== LIFTED Phase 6 Database Verification ===" -ForegroundColor Cyan

# 1. Verify container runtime
$docker = Get-Command docker -ErrorAction SilentlyContinue
$podman = Get-Command podman -ErrorAction SilentlyContinue

if (-not $docker -and -not $podman) {
    Write-Error "ENVIRONMENT BLOCKER: Neither Docker nor Podman is available on PATH. Please launch Docker Desktop or Podman to execute live PostgreSQL verification."
    exit 1
}

Write-Host "Container runtime verified." -ForegroundColor Green

# 2. Start isolated local Supabase
Write-Host "Starting disposable local Supabase instance..." -ForegroundColor Yellow
npx supabase start

try {
    # 3. Reset database to ensure clean initial migration state
    Write-Host "Applying migrations to disposable development database..." -ForegroundColor Yellow
    npx supabase db reset

    # 4. Execute pgTAP test suites
    Write-Host "Executing pgTAP security and RLS test suites..." -ForegroundColor Yellow
    npx supabase test db

    Write-Host "Database migrations and pgTAP tests PASSED successfully." -ForegroundColor Green
} finally {
    # 5. Stop local containers
    Write-Host "Tearing down local Supabase instance..." -ForegroundColor Yellow
    npx supabase stop
}
