# Spec: My Settings IA Restructure (Phase 0.5)

**Status:** Approved — ready to build (§7 decisions locked 2026-06-04)
**Author:** Peri Ginsberg + Claude (design conversation 2026-06-04)
**Date:** 2026-06-04
**Type:** UI / IA scaffolding. No data-layer changes beyond existing `/api/coach/pipeline`.
**Prerequisite for:** Coach Deliverables Library (Phase 1) → Packages (Phase 2) → SOW (Phase 4).

---

## 1. Goal

Reshape the Coaches Center "My Settings" surface so coach-domain settings have a
home that scales past Prospects. Specifically: make room for **Services**
(Deliverables + Packages) as a first-class settings domain alongside Prospects,
because offerings are a shared catalog consumed by Prospects, Clients, and SOW —
not a sub-section of the prospect funnel.

This phase ships the **nav-group + domain + tab scaffolding only**. Deliverables
and Packages content are Phases 1–2 (separate specs).

---

## 2. Current state (from 2026-06-04 recon)

My Settings is **already a routed, sectioned area** — not a flat page:

- Global sidebar (`app/dashboard/layout.tsx:39-68`, hardcoded `COACH_NAV`):
  My Settings is a **single item in the ACCOUNT group** →
  `/dashboard/coach/settings`.
- Settings area shell (`app/dashboard/coach/settings/layout.tsx`): renders a
  **vertical domain sub-nav** (`SUB_NAV`, lines 27-31): Prospects (live),
  Clients (disabled "Soon"), Interviewing (disabled "Soon").
- `settings/page.tsx` index server-redirects to `settings/prospects`.
- Prospects (`settings/prospects/page.tsx`): a stack of `SettingsBlock` cards —
  only **My Pipeline** (`MyPipelineSection.tsx`) exists; explicit comment slot
  for future blocks.
- Only backing data: `coach_pipeline_stages` via `/api/coach/pipeline`.

**Correction to prior handoff:** the handoff framed this as a "single-block page
that can't hold Deliverables + Packages." It's already multi-domain routed. This
restructure reshapes the existing route tree, not splits a flat page.

Clients / Interviewing were **placeholders** — final main-level domains TBD.

---

## 3. Target IA (Model A — flat domains, tabs inside each)

```
My Settings   (promoted to its own top-level nav GROUP in COACH_NAV)
├── Prospects        → tabs: Pipeline (live) | [future: Capture defaults, Source categories]
├── Services         → tabs: Deliverables (Soon) | Packages (Soon)
└── Billing          (Soon domain — separate S-sized PM feature, no content this phase)
```

Rationale locked in design conversation:
- Deliverables (atomic units a coach does) and Packages (priced bundles of
  deliverables) are **offerings**, independent of the prospect funnel. They get
  assigned to prospects AND clients AND feed SOW → shared catalog → own domain.
- Packages build on Deliverables (matches PM dependency order).
- SOW likely needs **no** My Settings domain — it's generated at the
  prospect/client level by assigning a package, not configured as a standing
  setting. Confirm at Phase 4.
- Profile & Personas is **per-client** (`clients/[clientId]/ProfilePersonasTab.tsx`),
  NOT a coach setting — stays out (data-scope boundary).

---

## 4. The two structural moves

### Move 1 — Promote My Settings to a top-level nav group

- In `COACH_NAV` (`layout.tsx`): remove the single ACCOUNT-group "My Settings"
  item; add a **My Settings group** whose items are the live domains:
  Prospects, Services, Billing.
- Domain items are **real routes** (`/dashboard/coach/settings/<domain>`) —
  deep-linkable, server-redirect + `startsWith` active detection preserved.
- The current **vertical domain sub-nav in `settings/layout.tsx` is removed** —
  domains now live in the global sidebar. The settings layout keeps only the
  area title + content pane. (This is what keeps the IA at two nav levels, not
  three — domains move sidebar-up.)
- `isGroupActive` highlight logic keys off item hrefs — verify the new group
  highlights correctly when on any `/settings/*` route.
- Update `settings/page.tsx` redirect target (stays → `prospects`).

### Move 2 — Add a horizontal tab layer inside each domain

- **Prospects:** tabs = Pipeline (live, renders existing `MyPipelineSection`).
  No other tabs yet.
- **Services:** new route `settings/services/page.tsx`. Tabs = Deliverables,
  Packages — both **Soon** (disabled, no content page).
- **Billing:** new route `settings/billing/page.tsx` OR Soon-domain stub —
  see §6 open item.

---

## 5. Tab mechanism (LOCKED)

**Query-param tabs (`?tab=pipeline`)**, matching the existing precedent at
`clients/[clientId]/page.tsx:529-545` (TABS array → buttons toggling state,
seeded from `?tab`).

- Lighter than per-tab sub-route files; Soon tabs need no page at all (disabled
  buttons).
- Domain level STAYS routed (Move 1) — only the tab level inside a domain is
  query-param.
- **Promotable later:** when Deliverables/Packages get real content, individual
  tabs can graduate to routed sub-segments if deep-linkable tab URLs matter.

No reusable Tabs primitive exists. Extract a small one (or inline per the
client-detail precedent). The client-detail bar is the **visual** reference but
is state+`?tab`-driven — fine to mirror for these domain tabs.

---

## 6. Scope boundaries

**In scope:**
- `COACH_NAV` nav-group promotion + active-highlight verification
- Remove vertical sub-nav from `settings/layout.tsx`; keep title + content pane
- Prospects: wrap existing Pipeline in a (single, live) tab bar
- Services: new domain route + Deliverables/Packages Soon tabs
- Reuse existing disabled-item "Soon" pattern (don't invent a new placeholder)

**Out of scope:**
- Any Deliverables / Packages content (Phases 1–2)
- Any Billing content (separate S feature)
- Any data-layer change (no new tables/routes; pipeline route untouched)
- Profile & Personas (per-client; stays at `clients/[clientId]`)
- Clients / Interviewing domains — **dropped from the nav** (were placeholders;
  no coach-level settings concept defined for either; re-addable later as one
  array entry if a real coach-level setting surfaces)

---

## 7. Decisions locked (2026-06-04)

1. **Billing:** scaffold as a **Soon domain** now (no content — that's the
   separate S-sized billing feature). Proves the group renders with 3 items.
2. **Clients / Interviewing:** **dropped** from the nav. Not coach-level
   settings concepts today; re-addable later if a real one surfaces.
3. **Tab mechanism:** **query-param** (`?tab=`), per §5.
4. **Group label:** **"My Settings"** (unchanged).

Resulting live group: **Prospects** (Pipeline tab, live) · **Services**
(Deliverables / Packages tabs, Soon) · **Billing** (Soon domain).

---

## 8. Build steps (each through the standard gate: tsc → build → diff → commit → push dev → SHA verify; UI steps click-through verified on staging)

1. **Nav-group promotion** — `COACH_NAV` edit + `isGroupActive` verify +
   `settings/layout.tsx` sub-nav removal + redirect check. (One commit; pure nav
   IA — smoke the sidebar + every `/settings/*` deep link.)
2. **Prospects tab wrapper** — wrap `MyPipelineSection` in the new tab bar
   (single live Pipeline tab). Extract the Tabs component here.
3. **Services domain** — new `settings/services/page.tsx` + Deliverables/Packages
   Soon tabs.
4. **Billing** (if §7.1 = yes) — Soon domain stub.

Step 1 is the load-bearing one (global nav change). Steps 2–4 are additive and
low-risk.

---

## 9. Landmines (from recon)

- Two hardcoded enable/disable lists must stay in sync if domains move: the nav
  array and `settings/page.tsx` redirect target.
- `MyPipelineSection` is a heavy self-contained client component (own fetch,
  dirty-state, banners) — keep the thin-wrapper boundary; don't fold tab state
  into the section.
- `/api/coach/pipeline` GET has a **write side-effect** (lazy-seeds default
  stages on first load) — unrelated to this restructure, but don't be surprised
  by it during smoke testing.
- Active-group highlight (`isGroupActive`) keys off hrefs — the new group must
  highlight on all `/settings/*` routes.
