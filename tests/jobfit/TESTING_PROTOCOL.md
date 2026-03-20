# WRNSignal Testing Protocol

## Default Testing Workflow
1. Run tests
2. Log issues
3. Normalize issue types
4. Prioritize top systemic failures
5. Fix only highest-leverage engine issues
6. Re-run parity
7. Repeat

## Rules
- One step at a time
- PowerShell commands whenever possible
- No over-explaining
- No hardcoding for one case
- Engine-level fixes only
- Do not mix decision validation with bullet quality unless explicitly entering bullet-quality phase
- Test, log, prioritize before proposing changes
- Aggregate by issue type before deciding what to fix

## Standard Logging File
tests/jobfit/logs/jobfit_issues.log

## Standard Questions Order
1. Is the decision correct?
2. If not, log issue
3. If yes, log hidden engine/rendering issues
4. After batch review, normalize issue types
5. Fix top 3 only

## Standard Commands
### Run parity
npx tsx tests/jobfit/runRouteParityCases.ts

### View results
(Get-Content tests\jobfit\results\route_parity_results.json | ConvertFrom-Json) | ConvertTo-Json -Depth 20

### Normalize issue types
(Get-Content tests\jobfit\logs\jobfit_issues.log) |
ForEach-Object { ( -split "\|")[1].Trim() } |
Group-Object |
Sort-Object Count -Descending |
Select-Object Count, Name

### Renderer failure cases
(Get-Content tests\jobfit\results\route_parity_results.json | ConvertFrom-Json) |
Where-Object {
    .why_bullets_joined -eq "" -and
    .raw.why_codes.Count -gt 0
} |
Select-Object id, decision_final, score,
    @{Name="why_codes_count";Expression={.raw.why_codes.Count}},
    @{Name="why_rendered_count";Expression={.raw.debug.why_count}} |
Format-Table -AutoSize
