$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

$resultsPath = Join-Path $repoRoot "tests\jobfit\results\results.csv"
$baselinePath = Join-Path $repoRoot "tests\jobfit\baselines\baseline-010\results.csv"
Write-Host ""
Write-Host "=== SIGNAL JobFit Regression Runner ==="
Write-Host "Repo root: $repoRoot"
Write-Host ""

if (-not (Test-Path "tests\jobfit\runLocalCases.ts")) {
    throw "Missing tests\jobfit\runLocalCases.ts"
}

if (-not (Test-Path "tests\jobfit\cases")) {
    throw "Missing tests\jobfit\cases folder"
}

Write-Host "Running local JobFit regression cases..."
npx tsx tests\jobfit\runLocalCases.ts

if (-not (Test-Path $resultsPath)) {
    throw "Results file was not created: $resultsPath"
}

Write-Host ""
Write-Host "Current results file found:"
Write-Host $resultsPath
Write-Host ""

if (-not (Test-Path $baselinePath)) {
    Write-Host "No baseline found at:"
    Write-Host $baselinePath
    Write-Host ""
    Write-Host "Run completed, but no comparison was performed."
    exit 0
}

Write-Host "Loading baseline:"
Write-Host $baselinePath
Write-Host ""

$current = Import-Csv $resultsPath
$baseline = Import-Csv $baselinePath

$currentMap = @{}
foreach ($row in $current) {
    $currentMap[$row.id] = $row
}

$baselineMap = @{}
foreach ($row in $baseline) {
    $baselineMap[$row.id] = $row
}

$allIds = @(
    $currentMap.Keys
    $baselineMap.Keys
) | Sort-Object -Unique
$changes = @()

foreach ($id in $allIds) {
    $cur = $currentMap[$id]
    $base = $baselineMap[$id]

    if ($null -eq $base) {
        $changes += [PSCustomObject]@{
            id = $id
            change_type = "NEW_CASE"
            field = ""
            baseline = ""
            current = "present"
        }
        continue
    }

    if ($null -eq $cur) {
        $changes += [PSCustomObject]@{
            id = $id
            change_type = "REMOVED_CASE"
            field = ""
            baseline = "present"
            current = ""
        }
        continue
    }

    $fieldsToCheck = @(
        "score",
        "penaltySum",
        "decision_initial",
        "decision_after_gate",
        "decision_final",
        "gate_type",
        "gate_code",
        "gate_detail",
        "why_code_list",
        "risk_code_list",
        "job_family",
        "job_location_mode",
        "job_location_city",
        "profile_location_mode",
        "profile_location_constrained"
    )

    foreach ($field in $fieldsToCheck) {
        if ($base.$field -ne $cur.$field) {
            $changeType = switch ($field) {
                "decision_initial" { "SCORING_CHANGE" }
                "decision_after_gate" { "GATE_CHANGE" }
                "decision_final" { "FINAL_DECISION_CHANGE" }
                "score" { "SCORING_CHANGE" }
                "penaltySum" { "SCORING_CHANGE" }
                "gate_type" { "GATE_CHANGE" }
                "gate_code" { "GATE_CHANGE" }
                "gate_detail" { "GATE_CHANGE" }
                default { "DETAIL_CHANGE" }
            }

            $changes += [PSCustomObject]@{
                id = $id
                change_type = $changeType
                field = $field
                baseline = $base.$field
                current = $cur.$field
            }
        }
    }
}

Write-Host "=== Regression Summary ==="
Write-Host "Cases in current run: $($current.Count)"
Write-Host "Cases in baseline:    $($baseline.Count)"
Write-Host "Total changes:        $($changes.Count)"
Write-Host ""

if ($changes.Count -eq 0) {
    Write-Host "No regression differences found."
    exit 0
}

$grouped = $changes | Group-Object change_type | Sort-Object Name
foreach ($group in $grouped) {
    Write-Host "$($group.Name): $($group.Count)"
}

Write-Host ""
Write-Host "=== Detailed Changes ==="
$changes | Format-Table -AutoSize

$diffPath = Join-Path $repoRoot "tests\jobfit\results\regression_diff.csv"
$changes | Export-Csv -Path $diffPath -NoTypeInformation

Write-Host ""
Write-Host "Diff written to:"
Write-Host $diffPath