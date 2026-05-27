# Beta Feedback v0.1 — Preflight Report 2026-05-27

Read-only investigation against the codebase for the FRD at
`docs/Features/beta-feedback-frd.md`. No code, schema, or DB changes were
made. Citations are `file:line`.

## Summary

The FRD's surface area is **mostly accurate, but three load-bearing
assumptions are wrong and change the build**: (1) there is **no reusable
slide-in component** — `AddNotePanel` is a page-local one-off and the FRD's
`<SlideInPanel>` does not exist; it must be built or cloned; (2) coach
routes do **not** use `getAuthedProfileText()` — they inline their own
auth + `is_coach` lookup, and `getAuthedProfileText` neither returns
`is_coach` nor returns null on failure (it throws); (3) **no icon library
is installed** (no `lucide-react`) and the nav is text-only, so the
`MessageSquare` icon assumption is moot. Two smaller mismatches: the
"active client count" filter the FRD specifies (Active+Inactive) does not
equal the "Active Clients" dashboard tile the coach sees (Active-only),
and the COACHES CENTER nav order/labels differ from the FRD.

**Biggest unknown:** the slide-in. It must be hoisted into the global
`app/dashboard/layout.tsx` (not page-local like `AddNotePanel`) because
it's triggered from the sidebar and must work on every coach page. That's
the half-day item the FRD flagged, and it's real.

Nothing here blocks the feature. The schema, Postmark wiring, and gate
patterns are all straightforward. The phase plan holds with minor
reordering noted below.

---

## Findings by section

### 1. Frontend slide-in infrastructure

**No generic slide-in / drawer / panel component exists.** A grep for
`slide|SlideIn|Drawer|Panel` surfaces exactly one slide-in in the coach
UI: `app/dashboard/coach/clients/[clientId]/AddNotePanel.tsx`.

`AddNotePanel` is a **self-contained one-off**, not a generic shell:
- It hardcodes its own backdrop (`position:fixed; inset:0; rgba bg;
  opacity transition`, `AddNotePanel.tsx:106-117`) and right-side panel
  (`position:fixed; top/right/bottom; width:460; transform:translateX;
  transition:0.22s`, `AddNotePanel.tsx:120-140`).
- Props: `{ open, onClose, onSaved, onSubmit }` (`AddNotePanel.tsx:32-43`).
  The parent injects the POST handler via `onSubmit` so the panel stays
  ignorant of auth/clientId plumbing — a good pattern to copy.
- It already implements Escape-to-close with an in-flight-save guard
  (`:69-79`), focus management (`:54-64`), and disabled/dimmed states
  during save (`:176-187`). All reusable as a model.
- It uses dashboard theme tokens (`T`, `textarea`, `btnPrimary`,
  `btnSecondary`, `eyebrow`, `label` from `lib/dashboard-theme`) and
  `SavingSpinner` (`:4-12`).

**It is mounted page-local**, inside the client detail page at
`app/dashboard/coach/clients/[clientId]/page.tsx:1499`, opened by a
"+ Add Note" button. It is not a global component.

**Modal pattern:** also one-offs, no shared component.
`CreateClientModal.tsx` and `prospects/AddProspectModal.tsx` each define
their own inline styles and overlay. Notably `CreateClientModal` uses a
*light* PLUM/ROSE palette (`CreateClientModal.tsx:8-16`), not the dark
`T.*` dashboard theme — so it is not a candidate host for the feedback
form. There is no `<Modal>` to reuse.

**The FRD's `<SlideInPanel open side width>` (§6.5) does not exist.** It
must be built. Two options:
- **(a) Clone `AddNotePanel`'s backdrop+panel structure** directly into
  `FeedbackSlideIn` (fast, low-risk, minor duplication). Aligns with the
  "no filler features" principle for a v0.1.
- **(b) Extract a tiny generic `<SlideInPanel side="right">` shell** from
  `AddNotePanel` and refactor both. ~Half-day, touches a working Notes
  surface (regression risk on a beta-critical screen).

Recommend **(a)** for v0.1; defer extraction.

**Critical placement detail:** the feedback slide-in must be hoisted into
`app/dashboard/layout.tsx` (the global layout that renders the nav),
because it's triggered from the sidebar and must work from every coach
page. That layout is already `"use client"` (`layout.tsx:1`), already
tracks `isCoach` (`:136, :227-242`), and already has Supabase token access
(`:231-233`) — so it's a clean host. This differs from `AddNotePanel`'s
page-local mounting and is the main structural decision for Phase 3/4.

### 2. Postmark sender configuration

`lib/email/sendClientInvite.ts:141-148` sends with `From: FROM_EMAIL`,
`MessageStream: MESSAGE_STREAM`.

`lib/postmark.ts` defines both as **env-driven, not literals**:
```
export const FROM_EMAIL = process.env.POSTMARK_FROM_EMAIL!      // :9
export const MESSAGE_STREAM = process.env.POSTMARK_MESSAGE_STREAM!  // :10
```

- **Current From pattern:** whatever `POSTMARK_FROM_EMAIL` is set to (not
  visible in code; not in any `.env.example`). Given every existing
  template is "Workforce Ready Now"-branded, it is almost certainly an
  `@workforcereadynow.com` address — a **different domain** than the
  `support@stopapplyingblind.com` the FRD wants. So the feedback sender
  **cannot reuse `FROM_EMAIL`**. Either hardcode
  `From: 'support@stopapplyingblind.com'` in `sendFeedbackNotification`
  (matches FRD §6.3, simplest for v0.1) or add a new
  `POSTMARK_FEEDBACK_FROM` env var.
- **Domain vs address verification:** this is a Postmark dashboard fact,
  not visible in code. The FRD claims domain verification for
  `stopapplyingblind.com` is complete. Postmark domain verification (DKIM
  + Return-Path on a Sender Domain) is **domain-level** — once a Sender
  Domain is verified, you can send from *any* address `@that-domain`
  without adding each as a Sender Signature. So if what Peri verified is a
  **Sender Domain** (not a single Sender Signature), `support@` works with
  no extra step. → Confirm with Peri (open question).
- **MessageStream:** the literal value of `POSTMARK_MESSAGE_STREAM` is not
  in code. Postmark's default transactional stream ID is literally
  `outbound`, so the FRD's assumption is likely correct, but rather than
  hardcode `'outbound'`, **reuse the `MESSAGE_STREAM` constant** from
  `lib/postmark.ts` for consistency with `sendClientInvite`.

### 3. `is_coach` gate

- **Field:** `is_coach` on `client_profiles`.
- **Definition:** `ADD COLUMN IF NOT EXISTS is_coach BOOLEAN DEFAULT false`
  — **nullable** (no `NOT NULL`), defaults to `false`. Defined in
  `supabase/migrations/20260413_coach_client_system.sql:7`. (All gate
  checks use `=== true` / `!is_coach`, so nullable/false-default is safe.)
- **Returned by `/api/profile`** in `PROFILE_SELECT`
  (`app/api/profile/route.ts:38`) — which the dashboard layout already
  consumes to set `isCoach` (`layout.tsx:235-238`).
- **Canonical check patterns (two variants, both inline — see §5):**
  - `app/api/coach/home/route.ts`: `getCoachProfile()` selects
    `id, name, is_coach, user_id` (`:65-71`), then
    `if (!coach.is_coach) return ...403` (`:231`). **Cleanest** — fetches
    name + is_coach in one query.
  - `app/api/coach/clients/route.ts`: a dedicated
    `verifyCoach(profileId)` selecting `is_coach` and checking `=== true`
    (`:69-91`).
- **Postmark-in-a-coach-route precedent:**
  `app/api/coach/coach-clients/[id]/send-invite/route.ts` matched both
  `is_coach` and the Postmark send — the closest existing analog to the
  new route (coach gate + email), worth modeling after for the combined
  shape.

Recommend modeling on `coach/home`'s `getCoachProfile` (extend its select
to `id, name, email, is_coach`) so the route gets everything the email
template needs (coach name + email) in the same lookup that gates.

### 4. `coach_clients` active client count query

FRD §6.2 filter: `coach_profile_id=? AND status='active' AND
lifecycle_status IN ('Active','Inactive')` (excludes Prospect, Archived).

**No existing single query returns this count.** The closest:
- `coach/home/route.ts` builds `aiProfileIds` = clients with
  `lifecycle_status === "Active" || "Inactive"` (`:545-548`), from
  relationships pre-filtered to `status='active'` (`:241`). This is the
  **exact same population** as the FRD filter — but it's computed in a JS
  loop and used for *application* metrics, never surfaced as a count.
- The **"Active Clients" metric tile** counts only
  `lifecycle_status === "Active"` (`:537`) — Inactive and Prospect
  excluded. So the tile ≠ the FRD filter.

So the new endpoint needs **its own count query**
(`.select('id', { count: 'exact', head: true })` with the FRD filter).
Trust the **FRD filter (Active+Inactive)** — it matches the documented
"portfolio scope" used for app metrics in `coach/home`. Add a one-line
runlog note recording that alignment.

**Gap to surface (see Gaps):** the email's "active clients" number
(Active+Inactive) will **not equal** the "Active Clients" tile
(Active-only) the coach sees on their own dashboard. If a coach ever
cross-checks, the numbers differ. Peri decision needed.

### 5. `getAuthedProfileText` / auth pattern

- **Location:** `app/api/_lib/authProfile.ts`, exported
  `getAuthedProfileText(req, opts?)` (`:178`).
- **Returns on success:** an `AuthedProfile` —
  `{ profileId, profileText, resumeText, profileStructured, jobType,
  targetRoles, targetLocations, timeline, activePersonaId, personaSource }`
  (`:62-75`). It does **NOT** return `is_coach`, `email`, or `name`.
- **Returns on failure:** it **throws** (`"Unauthorized: missing bearer
  token"` `:23`, `"Unauthorized: invalid token"` `:34`, `"Profile lookup
  failed…"` `:192`). It does **not** return null.
- **Side effect:** it auto-creates / attaches a `client_profiles` row when
  none is found (`:196-210, :254-297`) — a write side-effect, heavier than
  a coach gate needs.

**GAP — FRD §6.2 is inaccurate.** Coach routes do **not** use
`getAuthedProfileText`. The grep hits for it are all client/jobfit routes
(`jobfit/route.ts`, `positioning/v2/*`, `coverletter`, `networking`,
`profile-intake`). Coach routes inline their own helpers:
`getBearerToken` → `getAuthedUser` (`supabase.auth.getUser(token)`) → a
profile lookup that selects `is_coach`. The FRD's pseudocode
(`authenticateProfile()` returns null on fail; `getClientProfile()`
returns `is_coach`) matches **neither** `getAuthedProfileText`'s
throw-based contract **nor** its return shape.

**Reference coach routes to model the new handler on (clean):**
1. `app/api/coach/home/route.ts:46-90, 226-231` — bearer → getAuthedUser →
   getCoachProfile (id+name+is_coach) → 403 gate. Best model.
2. `app/api/coach/clients/route.ts:18-91` — same shape with a separate
   `verifyCoach`.
3. `app/api/coach/coach-clients/[id]/send-invite/route.ts` — coach gate +
   Postmark in one route (closest analog for gate+email).

### 6. Standard error response helpers

**No `errorResponse` / `successResponse` utility functions exist.** The
grep hits for `successResponse` in `jobfit-run-trial/route.ts:436` and
`jobfit-run-trial-open` are **local variable names** (a response *data*
object), not helpers.

**Canonical pattern:** `withCorsJson(req, data, status)` +
`corsOptionsResponse(origin)` from `app/api/_lib/cors.ts` (`:69-79`).
Canonical shapes:
- **Error:** `{ ok: false, error: "<message>" }` at the right status;
  sometimes `+ detail` (`jobfit-run-trial:164-167`).
- **Success:** coach/profile routes use `{ ok: true, ...data }`
  (`coach/clients/route.ts:204`, `profile/route.ts:191`).
- **Catch convention:**
  `status = msg.toLowerCase().includes("unauthorized") ? 401 : 500`
  (`coach/home:704-707`, `clients:205-208`, `profile:239-242`).

**GAP — FRD pseudocode `errorResponse(403, 'coaches_only', …)` /
`successResponse(201, {…})` don't exist.** Build the route with
`withCorsJson`. The FRD wants structured error slugs (`coaches_only`,
`severity_required`, etc.) and a `201` on success — both fine: put the
slug in the body (e.g. `{ ok:false, error:'coaches_only', message:'…' }`)
and pass `201` as the status arg. Optionally define a 3-line local
`err()`/`ok()` helper inside `route.ts`, but keep the `{ ok, error }`
convention the rest of the codebase uses.

### 7. `set_updated_at` trigger function

- **Referenced** (`FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()`)
  in three shipped migrations:
  `20260512_candidate_targeting.sql:106`,
  `20260512_positioning_runs_v2.sql:109`,
  `20260516_phase2_runs.sql:114` — each annotated "(Foundation DD-07)".
- **The `CREATE FUNCTION` definition is NOT in any tracked migration.** A
  grep for `CREATE … FUNCTION … updated_at` returns no matches. The
  function lives **only in the DB** (applied directly via the SQL Editor
  workaround; it was never version-controlled — a known debt that the new
  migration will perpetuate by referencing-but-not-defining it).
- **Prod:** exists (three shipped prod migrations depend on it; prod
  drift repair on 2026-05-26 applied positioning_runs_v2 + phase2_runs per
  memory, both of which `EXECUTE` it).
- **Dev:** almost certainly exists (those migrations predate dev), but the
  dev migration tracker has drifted, so don't assume.

**Recommendation:** before running the `beta_feedback` migration, run a
read-only existence check in **each** target DB:
`SELECT 1 FROM pg_proc WHERE proname='set_updated_at';`. If missing in
dev, create it first. The migration assumes it exists — don't run blind.

### 8. Sidebar nav structure

- **File:** `app/dashboard/layout.tsx` — **not** `components/coach/
  CoachSidebar.tsx` (that path doesn't exist). The coach-only
  `app/dashboard/coach/layout.tsx` is just a "Beta" banner; the global
  nav is in the parent.
- **Registration:** a **config array**. `COACH_NAV: NavGroup[]`
  (`layout.tsx:35-53`) and `D2C_NAV` (`:24-33`), where
  `NavGroup = { header, items: NavItem[] }` and
  `NavItem = { href, label, external?, matchPrefix? }` (`:15-22`). Rendered
  via `.map` into `<a href>` links (`:412-448`). Coach vs D2C chosen by
  `isCoach` (`:412`), which comes from `/api/profile` (`:235-238`).
- **COACHES CENTER group exists**, but order/labels differ from FRD §6.4:
  - **Actual order:** Dashboard → **My Clients** → **My Prospects** →
    **Required Actions** (`:38-45`).
  - **FRD's stated order:** Dashboard, Required Actions, My Clients,
    Prospects. (Required Actions is actually **last**, not second; label
    is "**My** Prospects", not "Prospects".)
- **Icon library: NONE.** `package.json` has no `lucide-react` (or any
  icon dependency). Existing nav items are **text-only** — no icons
  anywhere. The FRD's `MessageSquare`/`MessageCircle` assumption is wrong.
- **Structural blocker for a slide-in trigger:** every nav item renders as
  an `<a href>` that **navigates**. The Feedback item must **open a
  slide-in, not navigate**, and the `NavItem` type + the `.map` have no
  button/action variant. Two ways to handle:
  - extend `NavItem` with an optional `onClick`/`action` and branch the
    render (emit a `<button>` styled like the `<a>`), or
  - special-case the Feedback button as one extra element appended after
    the `COACH_NAV` map (simplest, least invasive). The slide-in open
    state + `<FeedbackSlideIn>` get hoisted into `DashboardLayout`.
- **Visibility gate:** reuse the existing `isCoach` state — render the
  Feedback button only when `isCoach` is true, same gate that already
  switches `COACH_NAV` vs `D2C_NAV`.

---

## Gaps surfaced

These are FRD assumptions that don't match codebase reality. Surfacing for
Peri before code:

1. **Reusable slide-in doesn't exist (§6.5).** `<SlideInPanel>` is
   fictional; `AddNotePanel` is a page-local one-off. Must clone or
   extract. Confirmed the FRD's open question #2 with a hard answer:
   **build one.**
2. **Coach routes don't use `getAuthedProfileText` (§6.2).** And that
   helper throws (doesn't return null) and doesn't return `is_coach`. The
   handler pseudocode needs to be rewritten to the coach-route inline
   pattern (bearer → `auth.getUser` → profile lookup selecting `is_coach`).
3. **`errorResponse`/`successResponse` helpers don't exist (§6.2).** Use
   `withCorsJson` + `{ ok, error }` convention.
4. **No icon library (§6.4).** No `lucide-react`. Nav is text-only.
   `MessageSquare` can't be imported without adding a dependency.
5. **"Active client count" mismatch (§6.2).** The FRD filter
   (Active+Inactive) ≠ the "Active Clients" dashboard tile (Active-only).
   The email number won't match what the coach sees on their dashboard.
6. **Nav order/label mismatch (§6.4).** Actual order is Dashboard → My
   Clients → My Prospects → Required Actions; label is "My Prospects".
   "Below Prospects" is ambiguous given the real order.
7. **`set_updated_at` isn't in version control.** Exists in DB only;
   verify presence (esp. dev) before migrating.

None of these block the feature; they change *how* it's built, not
*whether*.

---

## Proposed phase plan

The FRD's 5 phases hold. Adjustments below reflect the gaps; total
estimate **~1 day** (the slide-in clone is the long pole, but cloning
`AddNotePanel` is far cheaper than the half-day a from-scratch generic
component would cost).

**Phase 1 — Schema + Postmark infra (~1.5h)**
- Pre-check `set_updated_at` exists in dev (and note for prod) — Gap 7.
- `supabase/migrations/20260527_beta_feedback.sql` per §6.1; apply to dev
  via SQL Editor.
- `lib/email/sendFeedbackNotification.ts` modeled on `sendClientInvite.ts`,
  but **hardcode `From: support@stopapplyingblind.com`** (or new env var)
  — Gap (§2) — and **reuse `MESSAGE_STREAM`** from `lib/postmark.ts`.
- Inline template render (text + simple HTML).

**Phase 2 — API endpoint `POST /api/feedback` (~2h)**
- Model on `coach/home/route.ts` auth, **not** `getAuthedProfileText` —
  Gap 2. One `getCoachProfile` selecting `id, name, email, is_coach`.
- Gate `is_coach` → 403; validation (type enum, severity↔bug coupling,
  body length) → 400; insert; non-fatal email send; email-status
  writeback. Responses via `withCorsJson` (`{ ok, error }` / `201`) —
  Gap 3. Add `OPTIONS` via `corsOptionsResponse`.
- Own count query for active clients (Active+Inactive) — §4.

**Phase 3 — Slide-in component (~3h, long pole)**
- `FeedbackSlideIn.tsx` cloning `AddNotePanel`'s backdrop+panel structure
  (Gap 1, option a), with form / confirmation states.
- `FeedbackForm` (type chips, conditional severity, body+char count, reply
  checkbox) + `FeedbackConfirmation`. Reuse `lib/dashboard-theme` tokens +
  `SavingSpinner`.
- Server-side + client-side `page_url` sensitive-param strip (FRD §9 risk).

**Phase 4 — Nav integration (~1.5h)**
- In `app/dashboard/layout.tsx`: hoist slide-in open state + mount
  `<FeedbackSlideIn>` in `DashboardLayout` (Gap, §1 placement).
- Add Feedback as a **button** (text-only label — Gap 4), gated on
  `isCoach`. Either extend `NavItem` with `action` or append a special-
  cased element after the `COACH_NAV` map (§8). Confirm placement vs real
  order (Gap 6).
- Verify it opens from every coach page (Dashboard, My Clients + detail,
  My Prospects + detail, Required Actions, Applications).

**Phase 5 — Testing (~2h)** — per FRD §7 Phase 5 / §8, no changes.

---

## Open questions for Peri

1. **Slide-in approach:** clone `AddNotePanel`'s structure into
   `FeedbackSlideIn` (recommended, faster, isolates risk) or extract a
   shared `<SlideInPanel>` and refactor Notes too (cleaner long-term,
   touches a working beta screen)?
2. **Postmark From:** hardcode `support@stopapplyingblind.com` in the new
   sender, or add a `POSTMARK_FEEDBACK_FROM` env var? And — confirm the
   verified item in Postmark is a **Sender Domain** (DKIM+Return-Path on
   `stopapplyingblind.com`), so `support@` sends without a separate Sender
   Signature.
3. **Active-client number mismatch:** the email count (Active+Inactive,
   per FRD) won't equal the "Active Clients" tile the coach sees
   (Active-only). Keep the FRD's broader count, switch the email to
   Active-only to match the dashboard, or include both? (Recommend: keep
   Active+Inactive but label it precisely, e.g. "Active + Inactive
   clients", to avoid a mismatch with the tile.)
4. **Nav placement + label:** real order is Dashboard → My Clients → My
   Prospects → Required Actions. Put Feedback **after Required Actions**
   (true bottom of the COACHES CENTER group), or literally below My
   Prospects as §6.4 says? And confirm icon-less text label "Feedback" is
   acceptable (matches every other nav item; no icon lib installed).
5. **MessageStream:** OK to reuse the existing `POSTMARK_MESSAGE_STREAM`
   for feedback, or do you want feedback on a separate Postmark stream for
   isolation/analytics?

---

*Preflight complete. No files modified, no code run, no DB changes.
Awaiting Peri approval before Phase 1.*
