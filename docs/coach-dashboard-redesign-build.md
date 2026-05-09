# Coach Dashboard redesign — build summary

**Date:** 2026-05-08
**Scope:** Restructure the coach landing page (`/dashboard/coach`) into 4 stacked sections per the locked design — header strip, 8-tile metrics bar, Today's Schedule placeholder, Requires Action (collapsible), My Clients (collapsible single-row layout). Adapt to existing dark theme.

## Status

- ✅ Phase 1 (discovery) — done & approved
- ✅ Phase 2 (build) — done
- 🟡 Phase 3 (verification) — type-check + build clean; **browser walkthrough is yours**

## Files changed

### Modified
- `app/api/coach/home/route.ts` — extended per-client `stats` with two new counts: `offers` and `rejected` (each one extra `filter().length` on the existing `apps` array). No other API changes.
- `app/dashboard/coach/page.tsx` — full rewrite of the page body. Preserved: token helpers, access-denied state, Invite + Create-Client modals (Invite modal logic carried over verbatim).

### Other behavior changes worth flagging
- The previous client cards had inline **Notes** and **Remove** buttons on each row. The new single-row layout has only **Open →**. Notes was a stub ("Notes functionality coming soon") and Remove had a confirm-then-delete inline. Both are gone from this view. There's no replacement entry point for Remove in the new design — if you want it back, easiest path is a dropdown / overflow menu on the row, or the client detail page picks it up. Flagged for your call.
- Per-client cards previously showed email under the name. The new spec is name-only. Email is dropped from the row.

## API addition

```ts
// app/api/coach/home/route.ts — per-client stats now returns:
{
  applications, interviewing, pending_recs, interview_rate,
  offers,    // NEW: COUNT(application_status='offer')
  rejected,  // NEW: COUNT(application_status='rejected')
}
```

Top-level metrics (totals, averages) are computed **client-side** from the per-client stats array — no server-side aggregation. Decision per Phase 1 approval (Q3).

## The 8 metric tiles

```
Row 1: [Active clients]  [Total applications]  [Interviewing*]   [Offers in flight*]
Row 2: [Avg interview rate]  [Pending recs*]  [Active prospects‡]  [Clients per phase‡]

* colored value (info / success / warning)
‡ muted opacity 0.55, italic subtitle
```

| Tile | Source | Color |
|---|---|---|
| Active clients | `metrics.activeClients` | default |
| Total applications | sum of `clients[].stats.applications` | default |
| Interviewing | sum of `clients[].stats.interviewing` | `T.WRN_BLUE` (info) |
| Offers in flight | sum of `clients[].stats.offers` | `T.SUCCESS` (success) |
| Avg interview rate | mean across clients with submitted apps | default |
| Pending recs | sum of `clients[].stats.pending_recs` | `T.WRN_ORANGE` (warning) |
| Active prospects | placeholder, "—" + "Coming soon" | muted |
| Clients per phase | placeholder, "—" + "Methodology not yet configured" | muted italic |

**Avg interview rate** is computed only over clients that have submitted at least one application (i.e., have a non-zero applied/interviewing/offer/rejected count). Including dormant clients (rate=0) would drag the mean down meaninglessly. Documented inline in code.

## Avatar color hash logic

Algorithm: **djb2 (XOR variant)** — a classic non-cryptographic string hash. Modulo 5 for palette lookup. Deterministic: same name always picks the same color across renders.

```ts
function hashIndex(s: string, mod: number): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i)
  return Math.abs(h) % mod
}
```

Seed: `(name || email || "?").toLowerCase()` — name takes precedence, falls back to email if name is null. Lowercased so case differences don't shift colors.

Initials: first letter of first two whitespace-separated words; if only one word, first two letters. Uppercased.

### Dark-theme avatar palette

Translucent colored backgrounds + brighter text variants of each color (vs the pastel-on-light original spec):

| Slot | bg | text |
|---|---|---|
| Blue | `rgba(81,173,229,0.18)` | `#9FC9EE` |
| Amber | `rgba(254,176,106,0.18)` | `#FECDA0` |
| Purple | `rgba(167,139,250,0.18)` | `#C8B6F8` |
| Pink | `rgba(244,114,182,0.18)` | `#F4ADC9` |
| Green | `rgba(74,222,128,0.18)` | `#9CE7B5` |

## Section + collapsible behavior

Single shared `Section` wrapper component — card surface (`T.CARD` bg, `T.BORDER_SOFT` border, radius 14, padding 20), header row with leading icon + title + optional count pill + optional `headerRight` slot.

- **Requires Action** and **My Clients** both default to first 5 items, expand on "Show all N →" click. Local `useState<boolean>`. No server calls.
- Less-than-or-equal-to-5 items: button doesn't render.
- "Show fewer ←" appears once expanded.

## Inline icons (no new dep)

Three Tabler-style outline SVGs hand-rolled inline:
- `IconBell` — Requires Action header
- `IconUsers` — My Clients header
- `IconCalendar` — Today's Schedule header

1.5px stroke, currentColor, 18×18, `aria-hidden="true"`. Color set by parent (`T.WRN_ORANGE` on section headers). Adds ~30 lines to page.tsx vs adding `@tabler/icons-react` dep.

## Verification — what I ran

- ✅ `npx tsc --noEmit` — clean
- ✅ `npm run build` — clean, `/dashboard/coach` route registered

## Verification — your action

Run dev server (`npm run dev`) and walk these on a coach with at least 5 clients (use the dev fixture; coach is `peri+devcoach@example.com` if you've seeded it):

- [ ] Land on `/dashboard/coach`. All 4 sections render.
- [ ] **Header strip:** correct date in upper-case eyebrow, "Welcome back, {firstName}" with first name in orange.
- [ ] **Metrics bar:** 8 tiles, 4×2 grid. Interviewing/Offers/Pending recs in colored values. Active prospects + Clients per phase visibly muted (subtle reduced opacity, italic subtitles).
- [ ] **Today's Schedule:** dashed-border placeholder with "Calendar integration coming soon" + subtitle.
- [ ] **Requires Action:** if 5+ items, only 5 visible by default. "Show all N →" expands. "Show fewer ←" collapses. Clicking a row navigates to that client's dashboard.
- [ ] **My Clients:** if 5+ clients, only 5 rows visible. Each row: 28px avatar with deterministic color, name + active pill, 5 mini-cells (Apps/Intvw/Rate/Rej/Off), updates indicator, Open → button. "Show all N →" expansion works. Avatars: re-running with the same fixture → same colors per client.
- [ ] **Create + Invite buttons** in My Clients header still open their respective modals.
- [ ] **Layout sanity at ~1280px+:** 4-col tile grid + single-row client layout fit without wrapping. Below ~1100px the row may need to wrap — flag if it breaks.

## Deferred / open

1. **Notes and Remove on client rows** — dropped from new design per spec. Notes was a stub; Remove had no replacement entry point. If you want either back, suggest a dropdown / overflow menu per row.
2. **Email is no longer shown on the client row** — spec said "no email." If you want email-on-hover or a tooltip, easy add.
3. **Avg interview rate excludes dormant clients** (clients with 0 submitted apps). If you'd rather see "rate-across-all-clients" (lower number, more clients in denominator), one-line change.
4. **Color hash collisions** — 5-color palette over up to 17 clients today means duplicate colors. Acceptable per spec; if you wanted unique colors per client you'd need a larger palette.
5. **Collapse state is not persisted** across navigation. If you want "show all" to remember after a page refresh, would need localStorage. Not in spec.
6. **The page has no responsive breakpoint** — 4-col grid stays 4-col below ~1100px. The original spec didn't call for mobile. If you want graceful mobile, that's a follow-up.

## Not committed

Per your instruction. Awaiting your verification before commit.

## File diff summary

```
MODIFIED
  app/api/coach/home/route.ts          (~6 lines added — stats.offers + stats.rejected)
  app/dashboard/coach/page.tsx         (rewrite — 535 → ~610 lines)

NEW
  docs/coach-dashboard-redesign-build.md  (this file)
```
