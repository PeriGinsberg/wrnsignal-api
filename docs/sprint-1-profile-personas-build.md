# Sprint 1 — Profile & Personas wiring (build summary)

**Date:** 2026-05-07
**Scope:** Wire the existing Profile & Personas tab in the coach client view so coaches can edit profile fields and manage multiple personas. Pilot Release feature.

## Status

- ✅ Phase 1 (discovery) — done & approved
- ✅ Phase 2 (build) — done
- ✅ Migration applied to remote Supabase (user ran SQL editor)
- ✅ Backfill: 0 rows needed (every resume-bearing profile already has ≥1 persona)
- 🟡 Phase 3 (verification) — server-side verified; **UI walkthrough is yours**

## Files

### New
- `supabase/migrations/20260507_profile_personas_pilot.sql` — adds `client_personas.archived_at` and `client_profiles.coach_notes_{avoid,strengths,concerns}`, plus an active-personas index
- `app/api/coach/clients/[clientId]/personas/route.ts` — GET (list active+archived), POST (create, cap=10 active)
- `app/api/coach/clients/[clientId]/personas/[personaId]/route.ts` — PATCH (rename / set primary / archive / restore / edit resume body)
- `app/dashboard/coach/clients/[clientId]/ProfilePersonasTab.tsx` — extracted ~580-line component with autosave-on-blur profile editor + persona management
- `scripts/backfill-personas.ts` — runnable, dry-run by default

### Modified
- `app/api/coach/clients/[clientId]/profile/route.ts` — added PATCH (allowlisted editable fields, empty-string → null)
- `app/api/coach/create-client/route.ts` — writes `coach_notes_*` columns, also creates initial is_default=true persona row from resume_text
- `app/api/personas/route.ts`, `app/api/personas/[id]/route.ts` — POST/PUT/DELETE return 410 (pilot-disabled, GET still works)
- `app/dashboard/personas/page.tsx`, `app/dashboard/personas/[id]/edit/page.tsx` — replaced with redirects to `/dashboard`
- `app/dashboard/page.tsx` (Overview) — persona section now read-only; mutation handlers + state removed
- `app/dashboard/coach/clients/[clientId]/page.tsx` — uses new `ProfilePersonasTab` component; archived personas filtered from Source-a-Job persona selector + auto-default selection (bug caught while wiring)

## Schema migrations applied
- `client_personas.archived_at TIMESTAMPTZ NULL` (nullable timestamp = soft archive; NOT NULL = "is archived" check + when)
- `client_profiles.coach_notes_avoid TEXT NULL`
- `client_profiles.coach_notes_strengths TEXT NULL`
- `client_profiles.coach_notes_concerns TEXT NULL`
- Index `client_personas_profile_active_idx` on `(profile_id, is_default DESC, created_at DESC) WHERE archived_at IS NULL`

## Verification — what I tested

### ✅ `npx tsc --noEmit` — clean
### ✅ `npm run build` — clean, all new routes registered:
```
/api/coach/clients/[clientId]/personas
/api/coach/clients/[clientId]/personas/[personaId]
/api/coach/clients/[clientId]/profile  (now PATCH-capable)
```
### ✅ Migration columns confirmed live in Supabase
### ✅ HTTP smoke test (dev server running) — all auth/pilot gates fire:

| Endpoint | Without auth | Expected | Result |
|---|---|---|---|
| PATCH `/api/coach/clients/[id]/profile` | 401 | 401 | ✅ |
| GET `/api/coach/clients/[id]/personas` | 401 | 401 | ✅ |
| POST `/api/coach/clients/[id]/personas` | 401 | 401 | ✅ |
| PATCH `/api/coach/clients/[id]/personas/[pid]` | 401 | 401 | ✅ |
| POST `/api/personas` (pilot-disabled) | 410 | 410 | ✅ |
| PUT `/api/personas/[id]` (pilot-disabled) | 410 | 410 | ✅ |

## Verification — what's NOT yet tested (your action)

The 6 manual scenarios from the spec require a browser session as a real coach. I can't drive the browser. Walk through them and check off:

- [ ] **Open existing client's Profile & Personas tab as a coach.** Edit each field (job_type select, target_roles text, target_locations text, timeline select, three coach_notes textareas). Confirm the per-field "Saving…" → "Saved" indicator. Refresh the page. Verify changes persisted.
- [ ] **Add a new persona.** Click "+ Add Persona", give it a name, paste resume text (or upload PDF), click Create Persona. Verify it appears in the list with no Primary badge.
- [ ] **Set a non-primary persona as primary.** Verify the previous primary loses its Primary badge (only one Primary per client). After the click, refresh — verify it persisted.
- [ ] **Archive a persona.** Verify it moves to the archived section (greyed). Click Restore. Verify it returns to active.
- [ ] **Create a brand-new client through Create Client Account modal.** Verify the persona created at creation appears in the new client's Profile & Personas tab as Primary, with the resume_text intact.
- [ ] **Try editing as the client themselves** (sign in as a non-coach user, hit `/dashboard/personas`). Verify it redirects to `/dashboard`. Try POST `/api/personas` directly — verify 410 response.

## Known edge cases handled

- **Archive of only-active persona** — refused with 400 ("add another or set a different one as primary first")
- **Archive of default with another active** — auto-promotes the most-recently-created active to default before archiving
- **Setting `is_default = false` directly** — rejected; must designate another as primary
- **Cap counts active only** — archived personas don't consume slots
- **Default-persona resume sync** — preserved via `syncDefaultPersonaToProfile()` helper. Triggered when (a) the default's resume_text changes, OR (b) which persona is default changes (set primary, archive default with auto-promote)
- **Cleared field via blanking** — empty string treated as `NULL` in the PATCH so coach can clear a field by deleting all text

## Deferred items

None — everything in the spec was implemented except:

- **Drag-reorder of personas** — explicitly excluded per your "don't expose display_order" instruction. Sorting is by primary-first, then created_at desc, then archived at the bottom (reflected in the `display_order` field stored but not user-facing).

## Open questions

- **`archived_at TIMESTAMPTZ` vs boolean flag** — went with timestamptz (industry standard, gives both "is archived" + "when"). Documenting in case you'd prefer boolean.
- **PDF upload in Add Persona** — reuses `/api/resume-upload` which is the same endpoint CreateClientModal uses. No new infra.
- **Empty profile field treated as NULL** — empty string in PATCH body is normalized to NULL on save. This means clearing a field returns "—" in display vs an empty string. Confirm this is desired UX.

## Dev server

A dev server is running on port 3000 (`npm run dev`, background process `bpkg0zhkd`). You can hit the UI directly at `http://localhost:3000/dashboard/coach/clients/[clientId]?tab=analysis` for any of your real clients. Stop it via TaskStop / Ctrl+C when done.

## Not committed

Per your instruction: no commits made. Awaiting your verification before commit.
