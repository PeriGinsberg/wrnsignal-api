# deploy-to-prod.ps1
# Merges dev into main and pushes both branches.
# Usage: .\deploy-to-prod.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "`n=== Deploy dev -> main ===" -ForegroundColor Cyan

# 1. Make sure working tree is clean
$status = git status --porcelain
if ($status) {
    Write-Host "ERROR: Working tree is dirty. Commit or stash changes first." -ForegroundColor Red
    exit 1
}

# 2. Ensure we're on dev and up to date
git checkout dev
git pull origin dev

# 3. Run TypeScript check before deploying
Write-Host "`nRunning tsc --noEmit ..." -ForegroundColor Yellow
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: TypeScript errors found. Fix before deploying." -ForegroundColor Red
    exit 1
}
Write-Host "TypeScript check passed." -ForegroundColor Green

# 4. Switch to main, pull latest, merge dev
git checkout main
git pull origin main
git merge dev -m "Merge branch 'dev'"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Merge conflict. Resolve manually." -ForegroundColor Red
    exit 1
}

# 5. Push both branches
git push origin main
git checkout dev
git push origin dev

Write-Host "`n=== Deploy complete. main is now in sync with dev. ===" -ForegroundColor Green
