param(
  [string]$CsvPath = ".\jobfit_tests\jobfit_case_bank.csv",
  [string]$OutDir  = ".\jobfit_tests\cases",
  [switch]$Clean
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "BUILD-JOBFIT-CASES STARTED"

$root = (Get-Location).Path
$csvAbs = (Resolve-Path (Join-Path $root $CsvPath)).Path
$outAbs = Join-Path $root $OutDir

Write-Host "PWD:    $root"
Write-Host "CSV:    $csvAbs"
Write-Host "OUTDIR: $outAbs"

New-Item -ItemType Directory -Force -Path $outAbs | Out-Null

if ($Clean) {
  Write-Host "Cleaning existing JSON files in $outAbs"
  Get-ChildItem -Path $outAbs -Filter "*.json" -File -ErrorAction SilentlyContinue | Remove-Item -Force
}

$rows = Import-Csv $csvAbs
Write-Host ("Row count: {0}" -f $rows.Count)

# UTF-8 without BOM (prevents JSON.parse 'Unexpected token ﻿')
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function To-IntOrNull($v) {
  if ($null -eq $v) { return $null }
  $s = [string]$v
  if ([string]::IsNullOrWhiteSpace($s)) { return $null }
  return [int]$s
}

$written = 0
$skipped = 0

foreach ($r in $rows) {
  $id = [string]$r.id
  if ([string]::IsNullOrWhiteSpace($id)) { $skipped++; continue }

  $expectedDecision = [string]$r.expectedDecision
  $job = [string]$r.job
  $profileText = [string]$r.profileText

  if ([string]::IsNullOrWhiteSpace($expectedDecision) -or
      [string]::IsNullOrWhiteSpace($job) -or
      [string]::IsNullOrWhiteSpace($profileText)) {
    Write-Host "Skip $id (missing expectedDecision/job/profileText)"
    $skipped++
    continue
  }

  $minScore = To-IntOrNull $r.minScore
  $maxScore = To-IntOrNull $r.maxScore

  $case = [ordered]@{
    id = $id
    input = [ordered]@{
      mode = "test"
      job = $job
      profileText = $profileText
    }
    expect = [ordered]@{
      decision = $expectedDecision
    }
  }

  if ($null -ne $minScore) { $case.expect.minScore = $minScore }
  if ($null -ne $maxScore) { $case.expect.maxScore = $maxScore }

  $json = $case | ConvertTo-Json -Depth 20
  $outFile = Join-Path $outAbs ($id + ".json")

  [System.IO.File]::WriteAllBytes($outFile, $utf8NoBom.GetBytes($json))
  Write-Host "Wrote: $outFile"
  $written++
}

Write-Host ""
Write-Host ("Done. Wrote: {0}  Skipped: {1}" -f $written, $skipped)
