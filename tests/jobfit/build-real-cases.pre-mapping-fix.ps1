$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$csvPath = Join-Path $repoRoot "tests\jobfit\real_cases_input.csv"
$outDir = Join-Path $repoRoot "tests\jobfit\real_cases"

if (-not (Test-Path $csvPath)) {
    throw "Missing CSV: $csvPath"
}

if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir | Out-Null
}

Get-ChildItem $outDir -Filter "*.json" -ErrorAction SilentlyContinue | Remove-Item -Force

$rows = Import-Csv $csvPath

foreach ($row in $rows) {
    $targetFamilies = @()
    $targetText = (($row.target_roles + " " + $row.target_industries + " " + $row.adjacent_roles) | Out-String).ToLower()

    if ($targetText -match "marketing|brand|digital marketing|communications|creative") { $targetFamilies += "Marketing" }
    if ($targetText -match "finance|wealth|investment|asset management|capital markets|investor relations") { $targetFamilies += "Finance" }
    if ($targetText -match "accounting|financial reporting") { $targetFamilies += "Accounting" }
    if ($targetText -match "operations|process|strategy|business analyst|transformation|implementation|consulting") { $targetFamilies += "Analytics" }
    if ($targetText -match "policy|government|legislative|regulatory|public policy|government affairs") { $targetFamilies += "Government" }
    if ($targetText -match "legal|privacy|data protection|legal intake|legal services") { $targetFamilies += "Government" }
    if ($targetText -match "sales|advisor") { $targetFamilies += "Sales" }

    if ($targetFamilies.Count -eq 0) {
        $targetFamilies += "Other"
    }

    $targetFamilies = $targetFamilies | Select-Object -Unique

    $locations = @()
    if ($row.location_preferences) {
        $locations = ($row.location_preferences -split ";|,") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    }

    $tools = @()
    $toolSource = (($row.resume_paste + " " + $row.strongest_skills) | Out-String)

    $knownTools = @(
        "Excel","Google Analytics","Canva","PowerPoint","Word","Adobe Photoshop","Illustrator",
        "Premiere","After Effects","Figma","Framer","Sketch","HubSpot","Shopify","ZoomInfo",
        "Access","Financial Edge","Photoshop"
    )

    foreach ($tool in $knownTools) {
        if ($toolSource -match [regex]::Escape($tool)) {
            $tools += $tool
        }
    }

    $tools = $tools | Select-Object -Unique

    $profileText = @"
current_status: $($row.current_status)
university: $($row.university)
job_type_preference: $($row.job_type_preference)
target_roles: $($row.target_roles)
adjacent_roles: $($row.adjacent_roles)
target_industries: $($row.target_industries)
specific_companies: $($row.specific_companies)
do_not_want: $($row.do_not_want)
openness_to_non_obvious_entry_points: $($row.openness_to_non_obvious_entry_points)
location_preferences: $($row.location_preferences)
timeline_for_starting_work: $($row.timeline_for_starting_work)
strongest_skills: $($row.strongest_skills)
job_search_concerns: $($row.job_search_concerns)
feedback_style: $($row.feedback_style)
resume_paste: $($row.resume_paste)
cover_letter: $($row.cover_letter)
extra_context: $($row.extra_context)
"@

    $prefFullTime = $false
    if ($row.job_type_preference -match "full time") { $prefFullTime = $true }

    $hardNoRemote = $false
    $hardNoSales = $false
    $hardNoGovernment = $false
    $hardNoContract = $false
    $hardNoHourly = $false
    $preferNotAnalyticsHeavy = $false

    $doNotWant = (($row.do_not_want + " " + $row.job_search_concerns) | Out-String).ToLower()

    if ($doNotWant -match "remote") { $hardNoRemote = $true }
    if ($doNotWant -match "sales|commission") { $hardNoSales = $true }
    if ($doNotWant -match "government") { $hardNoGovernment = $true }
    if ($doNotWant -match "contract|temporary|temp") { $hardNoContract = $true }
    if ($doNotWant -match "hourly") { $hardNoHourly = $true }
    if ($doNotWant -match "analytics roles requiring programming|data or analytics roles requiring programming|highly technical finance|coding|software engineering|technical development") { $preferNotAnalyticsHeavy = $true }

    $mode = "unclear"
    if ($hardNoRemote) { $mode = "in_person" }
    elseif ($row.location_preferences -match "remote") { $mode = "remote" }

    $constrained = $false
    if ($locations.Count -gt 0) { $constrained = $true }

    $gradYear = $null
    if ($row.resume_paste -match "Expected May 20(\d{2})") {
        $gradYear = [int]("20" + $matches[1])
    }
    elseif ($row.resume_paste -match "May 20(\d{2})") {
        $gradYear = [int]("20" + $matches[1])
    }
    elseif ($row.current_status -match "Senior") {
        $gradYear = 2026
    }
    elseif ($row.current_status -match "Junior") {
        $gradYear = 2027
    }

    $yearsExperienceApprox = 1
    if ($row.current_status -match "Early stage professional") { $yearsExperienceApprox = 3 }

    $caseObject = [ordered]@{
        id = $row.case_id
        label = "$($row.first_name) $($row.last_name) - $($row.job_label)"
        profileText = $profileText.Trim()
        jobText = $row.job_description
        profileOverrides = [ordered]@{
            targetFamilies = @($targetFamilies)
            locationPreference = [ordered]@{
                constrained = $constrained
                mode = $mode
                allowedCities = @($locations)
            }
            constraints = [ordered]@{
                hardNoHourlyPay = $hardNoHourly
                prefFullTime = $prefFullTime
                hardNoContract = $hardNoContract
                hardNoSales = $hardNoSales
                hardNoGovernment = $hardNoGovernment
                hardNoFullyRemote = $hardNoRemote
                preferNotAnalyticsHeavy = $preferNotAnalyticsHeavy
            }
            tools = @($tools)
            gradYear = $gradYear
            yearsExperienceApprox = $yearsExperienceApprox
        }
        metadata = [ordered]@{
            profile_id = $row.profile_id
            job_id = $row.job_id
            job_label = $row.job_label
            expected_direction = $row.expected_direction
        }
    }

    $json = $caseObject | ConvertTo-Json -Depth 10
    $outPath = Join-Path $outDir ($row.case_id + ".json")
    Set-Content -Path $outPath -Value $json -Encoding UTF8
}

Write-Host "Built $($rows.Count) real case files in $outDir"
