#!/usr/bin/env bash
# LIFTED Phase 6: Automated Supabase Database & pgTAP Verification Script
# For Linux, macOS, and GitHub Actions CI

set -euo pipefail

echo "=== LIFTED Phase 6 Database Verification ==="

# 1. Check for container engine
if ! command -v docker &> /dev/null && ! command -v podman &> /dev/null; then
    echo "ENVIRONMENT BLOCKER: Neither Docker nor Podman is installed or available on PATH." >&2
    exit 1
fi

echo "Container runtime detected."

# 2. Start local Supabase containers
echo "Starting isolated local Supabase..."
npx supabase start

# Ensure cleanup on exit
cleanup() {
    echo "Stopping local Supabase containers..."
    npx supabase stop || true
}
trap cleanup EXIT

# 3. Apply migrations to fresh database
echo "Applying migrations to disposable database..."
npx supabase db reset

# 4. Run pgTAP test suites
echo "Running pgTAP security test suites..."
npx supabase test db

echo "=== All PostgreSQL migrations and pgTAP tests completed successfully! ==="
