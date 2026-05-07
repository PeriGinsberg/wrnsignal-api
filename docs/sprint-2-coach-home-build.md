# Sprint 2 — Coach Home / My Clients landing (build summary)

**Date:** 2026-05-07
**Scope:** Transform `/dashboard/coach` from a flat client list into a daily-home-base landing page. Coaches now redirect here at sign-in. Surfaces metrics, heuristic-driven Requires Action items, and per-client "since last visit" indicators.

## Status

- ✅ Phase 1 (discovery) — done & approved
- ✅ Phase 2 (build) — done
- ✅ Migration applied to PROD Supabase (user ran SQL editor)
- ⚠️  **Migration NOT applied to DEV Supabase** — see "Open questions"
- ✅ Phase 3 (verification) — server-side verified end-to-end on prod DB
- 🟡 Browser walkthrough is yours

## Files changed

### New
- `supabase/migrations/20260507_coach_home_landing.sql` — `coach_clients.last_viewed_at` + `signal_applications_status_history` + 2 indexes
- `app/api/_lib/applicationStatusHistory.ts` — single `logStatusChange()` helper, header documents all 8 writers that call it
- `app/api/coach/home/route.ts` — combined endpoint: greeting + metrics + clients + 6-rule requiresAction

### Modified
- `app/api/auth/send-link/route.ts` — coach branch routes to `/dashboard/coach`
- `app/api/coach/clients/[clientId]/profile/route.ts` — fire-and-forget `last_viewed_at` bump on GET
- `app/dashboard/coach/page.tsx` — full rewrite: greeting, metrics tiles (mirroring tracker style), Requires Action, client cards with "since last visit"

### Modified — status_history instrumentation (8 writers)
- `app/api/applications/route.ts` (POST)
- `app/api/applications/[id]/route.ts` (PUT)
- `app/api/interviews/route.ts` (auto-promote to interviewing)
- `app/api/coach/recommend-job/route.ts` (POST — coach as `changed_by`)
- `app/api/coach/recommendations/[id]/respond/route.ts` (PATCH)
- `app/api/coach/my-recommendations/[id]/respond/route.ts` (PATCH)
- `app/api/jobfit/route.ts` (×2 sites — fresh path + cache-hit path)

## Verification — what I ran

### Build / type
- `npx tsc --noEmit` — clean
- `npm run build` — clean, all routes registered

### Status history writer audit (8 of 8 PASS)

Tested against local dev server (Sprint 2 code) pointed at prod DB (which has migration). Used real test accounts: `peri@workforcereadynow.com` (coach) + `peri+testallison@workforcereadynow.com` (client). Each test created an app, triggered the writer via HTTP, queried `signal_applications_status_history`, then cleaned up.

| # | Writer | Trigger | History row landed | changed_by |
|---|---|---|---|---|
| W1 | `applications POST` | client creates app | `null → saved` ✓ | client (ae57aaf9) ✓ |
| W2 | `applications [id] PUT` | client changes status to applied | `saved → applied` ✓ | client ✓ |
| W3 | `interviews POST` | client creates interview | `applied → interviewing` ✓ | client ✓ |
| W4 | `coach/recommend-job POST` | coach creates rec (full JobFit run) | `null → saved` ✓ | **coach** (10467b45) ✓ |
| W5 | `coach/recommendations/[id]/respond PATCH` | client responds "applied" to rec | `saved → applied` ✓ | client ✓ |
| W6 | `coach/my-recommendations/[id]/respond PATCH` | client responds "applying" to rec | `saved → applied` ✓ | client ✓ |
| W7 | `jobfit POST` (cache-hit path, line 300) | re-run JobFit on same JD after deleting app | `null → saved` ✓ | client ✓ |
| W8 | `jobfit POST` (fresh path, line 472) | run JobFit on new JD | `null → saved` ✓ | client ✓ |

### `/api/coach/home` smoke test

Hit as `peri@workforcereadynow.com`:
- HTTP 200, returned 17 clients + 20 requiresAction items
- R1 (no_login) firing: 8 items
- R2 (rec_pending_review) firing: 7 items
- R6 (poor_fit_no_rec) firing: 5 items
- R3-R5 silent (no status_history rows yet — expected per "ships quiet for 7 days" decision)

Hit as non-coach client (`peri+testallison@…`):
- HTTP 403, `{"ok":false,"error":"Forbidden: caller is not a coach"}` ✓

### Edge cases verified
- **R3-R5 gating** ("status still equals transition"): inserted backdated `to_status='interviewing'` row 3 days ago, then moved app status past it. Hit `/api/coach/home`. R3 did NOT fire for the test app. ✓
- **Client with 0 apps and 0 recs**: shows in client list with `apps=0 pending_recs=0 updates_since_visit=0`. No errors. ✓
- **Client with `last_viewed_at = null`**: baseline falls back to `accepted_at`. All 17 clients in test had null `last_viewed_at` and all rendered fine. ✓
- **`last_viewed_at` bump**: GET on `/api/coach/clients/[id]/profile` correctly updates the row (verified before-null → after-now). ✓

### Edge cases NOT tested via runtime
- **R3-R5 firing positively**: requires backdated history rows that survive the gating (i.e. status is still the transitioned state AND coach hasn't viewed since). Achievable but non-trivial setup; relied on code review (line 387 in home/route.ts).
- **Inactive client with apps from before tracking existed**: no false alarms for them because status_history rows only exist for transitions AFTER migration. R3-R5 require a history row, so old quiet apps simply don't trigger those rules. Old apps WILL trigger R6 (poor_fit_no_rec) if signal_score < 60 and no coach rec — that's correct behavior.

## Manual UI scenarios — your action

I can't drive a browser. Walk through these on **PROD URL once Sprint 2 is deployed**:

- [ ] **Sign in as a coach** via fresh magic link → verify redirect lands on `/dashboard/coach` (not `/dashboard` or `/dashboard/tracker`)
- [ ] **Sign in as a non-coach** → verify normal D2C flow still works (lands on `/dashboard/tracker` or `/dashboard` per `profile_complete`)
- [ ] **Land on My Clients** → verify all sections render: greeting strip, metrics tiles (3), Requires Action, client list
- [ ] **Verify metrics tile visual style** matches `app/dashboard/tracker/page.tsx` pattern (big number + small label + thin card)
- [ ] **"Coming soon" / "Methodology not yet configured"** placeholders show correctly in tiles 2 + 3
- [ ] **Click a Requires Action item** → verify navigation to that client's dashboard
- [ ] **After viewing a client's dashboard**, return to My Clients → verify "since last visit" indicator drops to "No changes since your last visit" for that client
- [ ] **Empty Requires Action** state — verify "Nothing requires your attention right now." copy appears when `requiresAction.length === 0`
- [ ] **Active client count** matches reality (17 active clients per current API response)

## Known limitations / open questions

1. **Dev DB doesn't have the migration applied.** Only prod was migrated. If you intend to test against the local dev server normally (via `.env.development.local` → dev Supabase), you need to also run the SQL there. Sprint 1's migrations have the same gap.
2. **Coach.firstName cosmetic issue**: Peri's profile name is `"Coach: Peri Ginsberg"`. Splitting on whitespace gives `"Coach:"` as the first token, so the greeting reads `"Welcome back, Coach:"`. Easy fix: strip leading `Coach:` prefix or use a different name source. Not critical for pilot but visible. Flagging for your call.
3. **Sprint 2 code is NOT deployed to prod.** The audit ran against local dev server pointed at prod env. To reach the deployed app via browser, the commit needs to ship.
4. **R3-R5 ship "quiet"**: per your decision, no backfill of historical transitions. Rules dependent on transition timing fire only after new transitions accumulate post-launch. Expect R3/R4/R5 silent for ~7 days.
5. **R5 (offer) threshold is 1 day** — picked because spec didn't specify. Easy to tune in `home/route.ts` `baselineThresholds`.

## Deferred items

- **Interest_level rating changes in `updates_since_visit`** — explicitly excluded per your scope confirmation.
- **Drag-reorder for client cards** — not in spec; sorting is `updates DESC, attention, name`.
- **Coach.firstName parsing fix** — see open question 2 above. Lift-out work, not strictly part of this sprint.

## Not committed

Per your instruction: no commits made. 14 modified/new files staged-ready. Awaiting your verification before commit.

## Files: complete list

```
NEW
  supabase/migrations/20260507_coach_home_landing.sql
  app/api/_lib/applicationStatusHistory.ts
  app/api/coach/home/route.ts
  docs/sprint-2-coach-home-build.md (this file)

MODIFIED
  app/api/auth/send-link/route.ts
  app/api/coach/clients/[clientId]/profile/route.ts
  app/api/applications/route.ts
  app/api/applications/[id]/route.ts
  app/api/interviews/route.ts
  app/api/coach/recommend-job/route.ts
  app/api/coach/recommendations/[id]/respond/route.ts
  app/api/coach/my-recommendations/[id]/respond/route.ts
  app/api/jobfit/route.ts
  app/dashboard/coach/page.tsx
```
