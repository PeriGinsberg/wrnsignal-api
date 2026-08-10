> **⚠️ ABANDONED 2026-08-10.** Positioning v2 / Stage 1c was abandoned and its
> code deleted. This document describes a system that does not exist. It is kept
> as history, not as a spec — do not build from it. See
> [docs/positioning-v2-abandoned.md](positioning-v2-abandoned.md).

# Dev vs Prod Positioning Routing — Investigation
# Date: 2026-05-27
# Investigator: Claude Code (read-only; no code/commits)

> Pre-flight: origin/dev tip `cec0873e`, local in sync. Read-only.

## Headline

The dev and prod Framer bundles diverge by **one line in the tab dispatcher**:
prod renders `renderPositioning()` (v1), dev renders `renderPositioningV2()` (v2).
So on dev the user-facing Positioning tab is the **v2 case-workflow** (A/B/C), while
v1's render path + its "Run Positioning →" button are **dead code** (defined, never
dispatched). Consequently `positioningResult` (the v1 state the cover letter now
reads) is **never set in dev's normal flow**, so the held cover-letter fix is inert
on dev. The smallest reversible fix is a **one-line change at dev:8471**
(`renderPositioningV2()` → `renderPositioning()`), making dev mirror prod exactly.

**One correction to the premise:** the dev cover letter is **not actually consuming
v2 positioning**. v2's output lands in a *separate* state (`positioningV2Result`)
that is never passed to `/api/coverletter`. The cover letter only ever receives
`positioningResult` (v1) — which on dev is `null`. So the "cover letter informed by
v2" observation is a misattribution; what informed it was `jobfit_result`
(`cover_letter_strategy`), which the cover-letter call already passes. The
underlying concern — *dev doesn't mirror prod for positioning* — is nonetheless
fully confirmed.

## Current state — dev

**The Positioning tab renders v2.** Dispatcher (`framer/dev/maincomponent.txt:8469`):
```js
const renderMainOutput = () => {
    if (tab === "jobfit") return renderJobFit()
    if (tab === "positioning") return renderPositioningV2()   // ← v2
    if (tab === "coverletter") return renderCoverLetter()
    return renderNetworking()
}
```
- **v2 path (live):** a `useEffect` (dev:1576-1578) auto-fires `runPositioningV2(jrid)`
  on Positioning-tab entry when a JobFit run exists. `runPositioningV2` (dev:2073)
  POSTs `/api/positioning/v2/start` and writes **`setPositioningV2Result(data)`** +
  `setPositioningRunId(data.run_id)` (dev:2147-2148). `renderPositioningV2()`
  (dev:5891) dispatches to `renderCaseA/B/C` (dev:5913-5917) off
  `positioningV2Result.case`.
- **v1 path (dead in dev):** `renderPositioning()` (dev:3744) reads `positioningResult`
  and contains the **"Run Positioning →"** button wired to `runPositioning` (v1)
  (dev:4055-4059). But `renderPositioning()` is **never invoked** by the dispatcher —
  so the button never renders and `runPositioning` (v1) is never triggered in the
  normal flow.
- **Therefore `positioningResult` is set only by:** the deep-link hydration path
  (`?run=<id>` → GET `/api/runs/<id>` → `setPositioningResult(data.positioning)`,
  dev:1484) or the reset to `null` (dev:1750). In the ordinary JobFit→Positioning→
  CoverLetter flow it is **never populated** → stays `null`.

## Current state — prod

**The Positioning tab renders v1.** Dispatcher (`framer/prod/maincomponent.txt:7019`):
```js
const renderMainOutput = () => {
    if (tab === "jobfit") return renderJobFit()
    if (tab === "positioning") return renderPositioning()   // ← v1
    ...
}
```
- `renderPositioning()` shows the "Run Positioning →" button → `runPositioning`
  (prod) → POST `/api/positioning` (v1) → `setPositioningResult(data)` (prod:1844) →
  renders v1 output (`student_intro` / drivers / role_angle / summary / bullet edits).
- **Prod has no v2 path at all** — no `runPositioningV2`, no `/api/positioning/v2/start`
  call, no auto-fire. (The only `setPositioningResult(data.positioning)` in prod is
  the identical deep-link hydration at prod:1348.)
- So in prod `positioningResult` = the v1 response, and the cover letter (once the
  held fix lands) would receive real v1 positioning.

**Net divergence:** identical bundles except the one dispatcher line (and dev's
extra v2 machinery: the auto-fire `useEffect`, `runPositioningV2`,
`renderPositioningV2`/`renderCaseA-C`, and the `positioningV2Result`/
`positioningRunId` state).

## Current state — mobile

**Mobile matches prod (v1).** `signal-mobile/lib/api.ts:300` `runPositioning` →
POST `/api/positioning` (v1); `signal-mobile/app/(tabs)/positioning.tsx` reads
`positioningResult` from `useJob()` and renders the v1 shape. There is **no v2 path
in mobile** (no `/api/positioning/v2/start` call). So mobile is already aligned with
prod and needs no change.

## What `positioningResult` actually contains on dev

Tracing every writer of `positioningResult` in the dev bundle:
1. `setPositioningResult(data)` — inside `runPositioning` (v1, dev:2044). **Never
   reached in normal flow** because `renderPositioning()` (its only trigger UI) is
   never dispatched.
2. `setPositioningResult(data.positioning)` — deep-link hydration (dev:1484), only
   on `?run=<id>` entry; `data.positioning` is whatever `/api/runs/<id>` stored.
3. `setPositioningResult(null)` — reset (dev:1750).

**Conclusion:** in dev's ordinary JobFit→Positioning→CoverLetter flow,
`positioningResult` is `null`. The v2 result lives in the *separate*
`positioningV2Result` state and is **never** routed into `positioningResult` or into
the `/api/coverletter` body. So:
- The dev cover letter's `positioning` param = `positioningResult ?? null` = **null**.
- The dev cover letter is **not** consuming v2 positioning (nor v1) — only
  `jobfit_result` (`cover_letter_strategy` + why/risk summary), which it already
  passed before the held fix.

## Proposed minimum change

**Option (a) — flip the dev dispatcher to v1. Recommended. One line.**

```
File: framer/dev/maincomponent.txt   (~line 8471, inside renderMainOutput)

- if (tab === "positioning") return renderPositioningV2()
+ if (tab === "positioning") return renderPositioning()
```

This makes the dev Positioning tab render v1 exactly as prod does
(`renderPositioning()` → "Run Positioning →" → `runPositioning` → `/api/positioning`
→ `setPositioningResult` → v1 render). `positioningResult` becomes populated, so the
held cover-letter fix passes real v1 positioning. **Maximally reversible:** when v2
is production-ready, flip this one line back to `renderPositioningV2()` (and prod's
dispatcher flips the same way). All v2 code (auto-fire, `runPositioningV2`,
`renderPositioningV2`, `renderCaseA-C`, the v2 state) **stays intact in the dev
bundle** — it's preserved, just not dispatched.

**Residual (optional polish, not required):** the v2 auto-fire `useEffect`
(dev:1576-1578) would still fire `/api/positioning/v2/start` on tab entry, writing a
`positioning_runs_v2` row + `positioningV2Result` that is now unrendered. This is
**harmless** (a wasted background call; no user-visible effect). If the extra dev
DB rows / API calls are undesirable, also short-circuit the auto-fire:
```
File: framer/dev/maincomponent.txt   (~line 1576-1578, the auto-fire effect body)
add an early return so runPositioningV2(jrid) isn't called
```
But this is secondary — option (a)'s single line fully achieves the stated goal
(user-facing dev positioning = v1, matching prod).

**Why not the other options:**
- *Option (b) — keep v2 firing, reroute `positioningResult` to v1's response:* this is
  effectively what option (a) does already (rendering `renderPositioning()` runs v1
  and sets `positioningResult`), but cleaner — no need to also touch the auto-fire or
  the cover-letter wiring. Option (a) subsumes it.
- *Option (c) — disable only the auto-fire, leave the dispatcher on v2:* would leave
  the tab rendering `renderPositioningV2()` with a perpetual skeleton (v2 never
  fires) — worse, not better. Rejected.

## Risks / open questions

- **Dev-only change.** Per the Framer dev/prod discipline, this edits the **dev**
  bundle only; prod already renders v1, so do **not** mirror this to prod. (This is
  the rare case where dev and prod legitimately differ until v2 ships.)
- **Single dispatcher confirmed.** `renderMainOutput` is the only positioning-tab
  dispatch (grep found one site). The edit is on a **live** code path (not dead
  code), so the Framer minifier won't drop it — unlike dead-code edits, which it
  silently discards.
- **Reversibility is genuinely cheap** because the v2 code is left in place; flipping
  back is the inverse one-line change. No re-engineering.
- **Open question for Peri:** do you want the optional auto-fire short-circuit too
  (zero wasted v2/start calls + no stray `positioning_runs_v2` rows on dev), or is
  the harmless background call acceptable for keeping the diff to exactly one line?
- **Open question:** is there value in keeping a dev-only way to *view* the v2 case
  workflow (e.g., a debug toggle) while the default tab is v1? Option (a) hides v2
  from the dev UI entirely (still in code). If you want both, that's a slightly
  larger change (a toggle), not the one-liner.

## Bearing on the held cover-letter commit

The held cover-letter fix (`positioning: positioningResult ?? null`) is **inert on
dev today** because `positioningResult` is `null` (v1 never runs). Sequencing:

1. **Land the dev dispatcher flip first** (option (a), dev:8471). Then dev's
   Positioning tab runs v1 and populates `positioningResult`.
2. **Re-smoke the cover letter on dev:** JobFit → click **"Run Positioning →"** (now
   v1) → Generate Cover Letter → confirm the letter reflects v1 positioning themes
   (role angle, summary, bullet edits) *beyond* what `jobfit_result`
   (`cover_letter_strategy`) alone contributes. If it changes, `summarizePositioning`
   is working and the fix is verified. If it doesn't, investigate
   `summarizePositioning` before shipping.

Without step 1, the cover-letter re-smoke on dev cannot show positioning influence —
which is exactly why today's smoke was inconclusive/misattributed. **The dev routing
flip is a prerequisite for an honest cover-letter smoke** (and for honest smoke of
the upcoming v1 bullet-eval enhancement work).

---

*Report file: `docs/dev-positioning-routing-investigation-2026-05-27.md`*
