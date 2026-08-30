# deploy-to-prod.ps1
# Promotes the latest successful dev deployment to Vercel production.
# Usage: .\deploy-to-prod.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "`n=== Deploy dev -> production (via Vercel promote) ===" -ForegroundColor Cyan

# 1. Make sure there are no uncommitted CHANGES.
#
# --untracked-files=no is the whole point of this gate. Bare --porcelain lists
# untracked files too, and this repo carries ~80 of them: investigation docs,
# probe scripts, eval cases. None of that can reach a deployment, because Vercel
# builds from the pushed commit and an untracked file is by definition not in it.
# Counting them meant the gate was permanently red, which does not make a deploy
# safer, it makes the check something you work around.
#
# What it still catches is the thing that matters: a tracked file modified and
# not committed, which WOULD differ between what you tested and what ships.
#
# Nothing else here is relaxed. tsc --noEmit still has to pass, the push still
# has to succeed, and the GitHub Actions gate below still fails closed on
# anything that is not a completed run concluding "success".
$status = git status --porcelain --untracked-files=no
if ($status) {
    Write-Host "ERROR: Uncommitted changes to tracked files. Commit or stash first." -ForegroundColor Red
    Write-Host $status -ForegroundColor Red
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

# 4. Push dev to ensure Vercel (and GitHub Actions) have the latest
git push origin dev
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git push failed. Nothing was deployed." -ForegroundColor Red
    exit 1
}

# 5. Gate on GitHub Actions: CI for THIS exact commit must conclude "success".
#    Placed after the push (the run cannot exist until the commit is on origin)
#    and before we pick a deployment to promote, so an unverified commit can
#    never reach production.
#
#    FAIL CLOSED, in every direction:
#      - gh missing or unauthenticated  -> abort (cannot verify != verified)
#      - no run for this SHA yet        -> keep waiting, never treated as pass
#        ("gh run list" prints [] and exits 0 for an unknown SHA, so absence is
#         indistinguishable from success unless we check for it explicitly)
#      - run still queued / in progress -> keep waiting
#      - conclusion anything but success (failure, cancelled, timed_out,
#        action_required, skipped, null) -> abort
#      - overall timeout                -> abort loudly; a stuck run blocks
$CiWorkflowName = "CI"
$CiTimeoutMinutes = 20
$CiPollSeconds = 15

$sha = (git rev-parse HEAD).Trim()
$shaShort = $sha.Substring(0, 7)
Write-Host "`nGating on GitHub Actions for commit $shaShort ..." -ForegroundColor Yellow

$ghCmd = Get-Command gh -ErrorAction SilentlyContinue
if (-not $ghCmd) {
    Write-Host "ERROR: GitHub CLI (gh) not found on PATH." -ForegroundColor Red
    Write-Host "       The CI gate cannot be verified, so this deploy is blocked." -ForegroundColor Red
    Write-Host "       Install from https://cli.github.com/ then run: gh auth login" -ForegroundColor Red
    exit 1
}

gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: GitHub CLI is not authenticated. Run: gh auth login" -ForegroundColor Red
    Write-Host "       The CI gate cannot be verified, so this deploy is blocked." -ForegroundColor Red
    exit 1
}

$ciRun = $null
$deadline = (Get-Date).AddMinutes($CiTimeoutMinutes)
while ($true) {
    $raw = gh run list --commit $sha --json databaseId,status,conclusion,workflowName,url --limit 20
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: 'gh run list' failed for commit $shaShort. Deploy blocked." -ForegroundColor Red
        exit 1
    }

    # gh emits multi-line JSON; join before parsing (PS 5.1 pipes line by line).
    $rawText = ($raw | Out-String).Trim()
    $runs = @()
    if ($rawText) {
        # "[]" parses to $null, and @($null) is a 1-element array holding $null -
        # which then explodes on property access under Set-StrictMode. Guard it.
        $parsed = $rawText | ConvertFrom-Json
        if ($null -ne $parsed) { $runs = @($parsed) }
    }
    $ciMatches = @($runs | Where-Object {
        $null -ne $_ -and
        ($_.PSObject.Properties.Name -contains "workflowName") -and
        $_.workflowName -eq $CiWorkflowName
    })

    if ($ciMatches.Count -eq 0) {
        Write-Host "  no '$CiWorkflowName' run for $shaShort yet - waiting (absence is NOT a pass)" -ForegroundColor DarkGray
    } else {
        # Newest first, so index 0 covers re-runs correctly.
        $ciRun = $ciMatches[0]
        if ($ciRun.status -eq "completed") { break }
        Write-Host "  run $($ciRun.databaseId) status=$($ciRun.status) - waiting" -ForegroundColor DarkGray
    }

    if ((Get-Date) -gt $deadline) {
        Write-Host "`nERROR: TIMED OUT after $CiTimeoutMinutes minute(s) waiting for CI on $shaShort." -ForegroundColor Red
        if ($null -eq $ciRun) {
            Write-Host "       No '$CiWorkflowName' workflow run ever appeared for this commit." -ForegroundColor Red
            Write-Host "       Check that .github/workflows/ci.yml exists on the pushed branch" -ForegroundColor Red
            Write-Host "       and that Actions is enabled: gh workflow list" -ForegroundColor Red
        } else {
            Write-Host "       Last seen status: $($ciRun.status)" -ForegroundColor Red
            Write-Host "       $($ciRun.url)" -ForegroundColor Red
        }
        Write-Host "       NOTHING WAS PROMOTED. Production is unchanged." -ForegroundColor Red
        exit 1
    }
    Start-Sleep -Seconds $CiPollSeconds
}

if ($ciRun.conclusion -ne "success") {
    Write-Host "`nERROR: CI concluded '$($ciRun.conclusion)' for commit $shaShort - NOT success." -ForegroundColor Red
    Write-Host "       $($ciRun.url)" -ForegroundColor Red
    Write-Host "       NOTHING WAS PROMOTED. Production is unchanged." -ForegroundColor Red
    Write-Host "       Fix the failure, push again, and re-run this script." -ForegroundColor Red
    exit 1
}
Write-Host "CI passed for $shaShort ($($ciRun.url))." -ForegroundColor Green

# 6. Find the latest successful dev Preview deployment
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

# 7. Promote to production
echo "y" | npx vercel promote $url
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Vercel promote failed." -ForegroundColor Red
    exit 1
}

# 8. Wait and verify
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
