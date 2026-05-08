# Sprint 3 — Coach navigation restructure + Overview rename

**Date:** 2026-05-08
**Scope:** Reshape sidebar nav for coaches. Rename "Overview" → "My Account" globally. Split the existing Coach Home page into a Dashboard summary + two new full-list pages (Required Actions, My Clients). Re-enable persona self-edit for coaches only on the My Account page.

## Status

- ✅ Build (Phase 2) — done
- 🟡 Browser walkthrough — yours

## Files changed (8)

### Modified
- **`app/dashboard/layout.tsx`** — nav fully restructured into `D2C_NAV` and `COACH_NAV` group arrays, conditional render by `isCoach`. Group headers ("DASHBOARD" / "COACHES CENTER" / "ACCOUNT") become orange when any child is active. "Back to SIGNAL" external link extracted to its own block. ResumeRx + Job Tracker hidden from coach nav entirely. "Overview" → "My Account" label change.
- **`app/api/auth/send-link/route.ts`** — comment update only ("Overview" → "My Account").
- **`app/dashboard/coach/page.tsx`** (Dashboard) — "Show all N →" buttons now navigate (`router.push`) to the new full-list pages instead of expanding inline. Inline-expand state removed from `RequiresActionSection` and `MyClientsSection`.
- **`app/api/personas/route.ts`** — POST open to any authenticated user creating their own persona. Cap = 10. Security: insert scoped to caller's `profile_id`.
- **`app/api/personas/[id]/route.ts`** — PUT + DELETE open to any authenticated user mutating their OWN persona. Security: lookup `.eq("profile_id", profileId)` filters to caller's rows only. Preserved: default-persona resume sync to `client_profiles.resume_text`, set-default cascade clearing other defaults, default-promotion when default is deleted.
- **`app/dashboard/page.tsx`** (My Account) — `is_coach` added to `Profile` type (kept for future use; not used for gating today). Persona section has Edit / Set as Default / Add Persona / Delete UI for ALL users on their own data. The Sprint 1 "your coach manages your personas" copy removed — no longer accurate.
- **`app/dashboard/personas/page.tsx`** + **`app/dashboard/personas/[id]/edit/page.tsx`** — comment headers updated. Pages still redirect to `/dashboard` (My Account is now the single home for persona management).

### New
- **`app/dashboard/coach/required-actions/page.tsx`** — full Required Actions list. Same row format as Dashboard's Requires Action section. No filtering, sorting, grouping, snooze, dismiss (per Q3 = α).
- **`app/dashboard/coach/clients/page.tsx`** — full client list. Same single-row layout as Dashboard's My Clients section, sorted same way (updates desc → attention → name).

## Key decisions executed

| Decision | Choice |
|---|---|
| Routing | **Keep `/dashboard/*`** — added two new pages within (`/dashboard/coach/required-actions`, `/dashboard/coach/clients`) rather than introducing `/coach/*` |
| Overview → My Account scope | Trivial — only 2 references existed (nav label + one comment) |
| Persona self-edit | **Open to any authenticated user editing their OWN data** (revised 2026-05-08). Original Sprint 1 pilot constraint was over-broad — it correctly forced coaches editing CLIENTS' personas through the coach-context routes, but it also incorrectly blocked D2C users + coach-managed clients from editing their own personas. Security gate is per-row ownership (`.eq("profile_id", caller_profile_id)`), not role. |
| Show all → behavior (Q2) | **(ii) navigate** — Dashboard "Show all N →" links to the new full pages. Inline-expand removed. |
| Required Actions v1 scope (Q3) | **(α) plain unfiltered list** — same row format as Dashboard, no group-by headers |

## API surface — persona endpoints

| Method | Route | Sprint 1 | Sprint 3 final |
|---|---|---|---|
| GET | `/api/personas` | open | open |
| POST | `/api/personas` | 410 | **open — any auth user creates own persona** |
| PUT | `/api/personas/[id]` | 410 | **open — any auth user mutates OWN persona only** |
| DELETE | `/api/personas/[id]` | 410 | **open — any auth user deletes OWN persona only** |
| GET/POST | `/api/coach/clients/[id]/personas` | open (coach managing client) | unchanged |
| PATCH | `/api/coach/clients/[id]/personas/[pid]` | open (coach managing client) | unchanged |

**Two parallel surfaces, both for legitimate use cases:**
- `/api/personas/*` — self-edit. Security: `.eq("profile_id", caller_profile_id)` ensures only own rows are touched.
- `/api/coach/clients/[id]/personas/*` — coach-on-client edit. Security: active `coach_clients` link + `access_level = full`.

For coach-managed clients, both surfaces target the same persona rows. Last-write-wins on concurrent edits — confirmed acceptable for pilot. Each writer also bumps `persona_version`, and the default-persona resume sync runs from both surfaces, so the per-table state stays consistent.

## Verification — what I ran

- ✅ `npx tsc --noEmit` clean
- ✅ `npm run build` clean — both new routes registered as static (`○`)

## Verification — your action

Run dev server (`npm run dev`) — you'll need to be a coach (`is_coach=true`) to see the coach nav. Use the dev fixture's coach if needed.

**Coach scenarios:**
- [ ] Sign in as coach → land on `/dashboard/coach`. Sidebar shows: COACHES CENTER (Dashboard / Required Actions / My Clients) + ACCOUNT (My Account) + Back to SIGNAL. NO Job Tracker, NO ResumeRx, NO old "My Clients" top-level item.
- [ ] On `/dashboard/coach`: "Dashboard" highlighted in orange. COACHES CENTER header also orange (group-active state).
- [ ] Click "Required Actions" → land on `/dashboard/coach/required-actions`, see the full action list with same row format.
- [ ] Click "My Clients" → land on `/dashboard/coach/clients`, see the full single-row client list.
- [ ] Visit `/dashboard/coach/clients/[id]` (any client) → "My Clients" link still highlighted (matchPrefix).
- [ ] On Dashboard: confirm "Show all N →" buttons under Requires Action and My Clients navigate to the corresponding full pages.
- [ ] Click "My Account" → land on `/dashboard`. Coach sees Edit Profile + persona section with Edit / Set as Default / Add Persona buttons. Add a persona → succeeds. Edit name → succeeds. Set non-default as default → previous default cleared. Delete a non-only persona → succeeds.
- [ ] Coach drills into a client → Profile & Personas tab. Edit a CLIENT persona via the coach-context flow → succeeds. Confirm `/api/coach/clients/[id]/personas/*` routes still work as before.
- [ ] Click "Back to SIGNAL" → Framer redirect with token (existing behavior).

**D2C user (no coach relationship) scenarios:**
- [ ] Sign in as D2C user → sidebar shows: DASHBOARD (My Account / Job Tracker / ResumeRx) + Back to SIGNAL. "Overview" is now labeled "My Account".
- [ ] Visit `/dashboard` → see Edit Profile button + persona section with Edit / Set as Default / Add Persona / Delete UI. **Persona self-edit fully functional** (same UI as coach — was the broken behavior).
- [ ] Add a persona → succeeds. Edit name → succeeds. Set as default → previous default cleared. Delete a non-only persona → succeeds.

**Coach-managed client scenarios:**
- [ ] Sign in as a coach-managed client (e.g., a fixture client like `alex+test@example.com`) → sidebar is D2C-shaped (no COACHES CENTER, "Overview" → "My Account").
- [ ] Visit `/dashboard` (My Account) → see persona section with full edit UI. Add/edit/delete own personas works.
- [ ] Coach also viewing this client's Profile & Personas tab in the coach-context view sees the same personas. If both edit at once, last-write-wins (acceptable for pilot — coach and client expected to coordinate).

## Deferred / open

1. **Required Actions filtering / sorting / snooze / dismiss / custom rules** — explicitly post-pilot per spec.
2. **Required Actions / My Clients pages don't show "back to Dashboard" breadcrumb** — could add later if useful. Sidebar nav serves as the back path.
3. **My Account on coach side** — same page as D2C. No coach-specific bio/credentials/specialties (out of scope).
4. **Persona cap is 10 for both coach (managing client) and self-service** — was inconsistent in Sprint 1 (was 2 for self, 10 for coach-on-client). Now harmonized to 10. If you want different caps for self vs coach-on-client, let me know.
5. **The old `app/dashboard/personas/page.tsx` redirect** still sends users to `/dashboard`. For coaches, that's now correct (they can manage personas there). For clients, same behavior as Sprint 1. No change needed.

## Mobile responsiveness

Out of spec per task brief. The 220px-wide sidebar will collapse on narrow viewports if a future task adds responsive breakpoints. New pages inherit the desktop layout patterns.

## Not committed

Per instructions. Awaiting your verification before commit.

## File diff summary

```
MODIFIED
  app/dashboard/layout.tsx                          (nav restructure + rename)
  app/api/auth/send-link/route.ts                   (comment-only)
  app/dashboard/coach/page.tsx                      (Show all → navigate)
  app/api/personas/route.ts                         (open self-edit POST, ownership-scoped)
  app/api/personas/[id]/route.ts                    (open self-edit PUT/DELETE, ownership-scoped)
  app/dashboard/personas/page.tsx                   (comment-only — header refresh)
  app/dashboard/personas/[id]/edit/page.tsx         (comment-only — header refresh)
  app/dashboard/page.tsx                            (persona self-edit UI for coaches)

NEW
  app/dashboard/coach/required-actions/page.tsx     (full action list)
  app/dashboard/coach/clients/page.tsx              (full client list)
  docs/sprint-3-coach-nav-build.md                  (this file)
```
