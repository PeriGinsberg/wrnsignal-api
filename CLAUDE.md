# Signal — JobFit Scoring Engine

## What this project is

Signal is a job-fit evaluation platform. Users paste a job description and the system scores how well their profile matches, producing a decision (Priority Apply / Apply / Review / Pass) with evidence-backed WHY codes, RISK codes, and actionable bullets.

The scoring engine is fully deterministic — no LLM in the scoring loop. An LLM (Claude Haiku) is used only for bullet text rendering (V5 renderer).

## Architecture

```
User input (resume + JD + title + company)
  → extract.ts       — extract job signals + profile signals (heuristic detectors)
  → scoring.ts       — build evidence matches, compute base score, apply penalties
  → decision.ts      — score → decision, gate overrides, risk downgrades, evidence guardrails
  → jobfitEvaluator.ts — orchestrator that wires the above together
  → bulletGeneratorV5.ts — LLM renders human-readable WHY/RISK bullets
  → route.ts         — API handler, Supabase caching, application tracking
```

Key files:
- `app/api/jobfit/extract.ts` (~4200 lines) — all extraction: section-aware JD parsing, CAPABILITY_RULES, FUNCTION_LEVEL_RULES, tool detection, family inference, years parser
- `app/api/jobfit/scoring.ts` (~1700 lines) — evidence matching, coverage, penalties, base score computation
- `app/api/jobfit/decision.ts` (~180 lines) — decision thresholds, risk downgrades, evidence guardrails with quality-gated direct WHYs
- `app/api/_lib/jobfitEvaluator.ts` (~160 lines) — orchestrator
- `app/api/jobfit/route.ts` — POST handler with Supabase caching

## Testing tools

### Regression check (26 hand-crafted cases)
```bash
npx tsx tests/jobfit-regression/regression-check.ts
npx tsx tests/jobfit-regression/regression-check.ts --update-baseline
npx tsx tests/jobfit-regression/regression-check.ts --verbose
```
Compares 26 cases (21 CSV batch + 5 retest scripts) against `baseline.json`. Exit 1 on drift. Always run after scoring changes. Review every diff before updating baseline.

### Production data inspection (508+ real runs from Supabase)
```bash
npx tsx tests/jobfit-regression/inspect-prod-runs.ts
npx tsx tests/jobfit-regression/inspect-prod-runs.ts --inspect <row-id>
npx tsx tests/jobfit-regression/inspect-prod-runs.ts --since 2026-04-01
npx tsx tests/jobfit-regression/inspect-prod-runs.ts --limit 2000
```
Read-only analysis of historical `jobfit_runs` table. Prints decision/score/family distributions, structural outlier detection (7 rules), family skew table (job classification vs profile targets), and outcome cross-tab. `--inspect` mode prints full decision cascade for a single row.

Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.

### Individual retest scripts
```bash
npx tsx tests/jobfit-regression/retest-013-ryan.ts   # Ryan vs Hennion & Walsh
npx tsx tests/jobfit-regression/retest-012-ryan.ts   # Ryan vs Raymond James
npx tsx tests/jobfit-regression/retest-reece-01.ts   # Reece
npx tsx tests/jobfit-regression/retest-026.ts        # Case 026
npx tsx tests/jobfit-regression/retest-emma-01.ts     # Emma
```

## Known architectural debt (ranked by impact)

1. **Bare-word `.includes()` matching** — biggest recurring bug source. Every CAPABILITY_RULES phrase is a substring match with no word boundaries or context. Confirmed in production: `content_execution` matched on "no pure social media content roles" (a constraint line, not experience). Fix: pre-compile phrases to word-boundary regexes with optional `requiresNearby` / `negativeContext` fields. Touches all 30+ detectors. Next major refactor target.

2. **Section-aware JD parsing** — SHIPPED (2026-04-09, commit `b2b0c387`). `segmentJobText()` + `filterJobTextToRequirements()` drops company/benefits/how-to-apply sections before unit extraction.

3. **Adjacency graph produces semantic nonsense matches** — adjacent-match weights can dominate direct matches. Needs per-edge compatibility checks. Medium priority.

4. **Professional-experience scoped years parser** — DONE. `extractProfessionalExperienceText()` excludes Leadership/Volunteer/Activities sections.

5. **Quality-gated direct WHYs in guardrails** — SHIPPED (2026-04-09, commit `d45c49da`). Direct WHYs need weight >= 75 AND non-boilerplate profile_fact to escape Review cap.

6. **Detector registration is triplicated** — regex def, functionTags.push, family cascade, sometimes also jobfit-family-inference.ts. Should be a single declarative table.

## Database

Supabase Postgres. Key tables:
- `jobfit_runs` — historical scoring results. `result_json` (jsonb) has full output but NOT raw jobText/profileText.
- `signal_applications` — job tracking with status (saved/applied/interviewing/offer/rejected/withdrawn). `application_status` tracking beyond "saved" introduced 2026-04-08.
- `client_profiles`, `client_personas` — user profiles and personas.

## Workflow for scoring changes

1. Make the change in extract.ts / scoring.ts / decision.ts
2. Run `npx tsx tests/jobfit-regression/regression-check.ts`
3. Review every diff line — each must be intended improvement or needs another fix
4. Run `--update-baseline` only after verifying all diffs
5. Commit code + baseline.json together
6. Optionally run `inspect-prod-runs.ts` to check structural health

## Mobile app

`signal-mobile/` — React Native / Expo app (untracked in git). Built via EAS:
```bash
cd signal-mobile
npx eas-cli build --platform ios --profile production --auto-submit
```
`--auto-submit` pushes directly to TestFlight after build completes.

## Style preferences

- Be concise and direct
- Don't add features beyond what's asked
- Don't add error handling for impossible scenarios
- Don't create abstractions for one-time operations
- Audit every regression case individually — don't trust automated decisions blindly
