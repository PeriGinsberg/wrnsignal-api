# deploy-to-prod.ps1
# Promotes the latest successful dev deployment to Vercel production.
# Usage: .\deploy-to-prod.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "`n=== Deploy dev -> production (via Vercel promote) ===" -ForegroundColor Cyan

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

# 4. Push dev to ensure Vercel has the latest
git push origin dev

# 5. Find the latest successful dev Preview deployment
Write-Host "`nFinding latest successful dev deployment..." -ForegroundColor Yellow
$deployments = npx vercel ls 2>&1
$devReady = ($deployments | Select-String "wrnsignal-api\s+" | Select-String "Ready" | Select-String "Preview" | Select-Object -First 1).ToString()

if (-not $devReady) {
    Write-Host "ERROR: No successful dev Preview deployment found. Wait for Vercel to build dev, then retry." -ForegroundColor Red
    exit 1
}

# Extract the deployment URL
$url = ($devReady | Select-String -Pattern "https://\S+").Matches[0].Value
Write-Host "Promoting: $url" -ForegroundColor Yellow

# 6. Promote to production
echo "y" | npx vercel promote $url
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Vercel promote failed." -ForegroundColor Red
    exit 1
}

# 7. Wait and verify
Write-Host "`nWaiting for deployment..." -ForegroundColor Yellow
Start-Sleep -Seconds 45
$latest = npx vercel ls 2>&1
$prod = ($latest | Select-String "wrnsignal-api\s+" | Select-String "Ready" | Select-String "Production" | Select-Object -First 1).ToString()

if ($prod) {
    Write-Host "`n=== Production deploy successful ===" -ForegroundColor Green
    Write-Host $prod
} else {
    Write-Host "`nDeployment may still be building. Check with: npx vercel ls" -ForegroundColor Yellow
}
