# Contacts Page — Reimagined (App, not Spreadsheet)

Add to `docs/network-tracker/` as `UX-CONTACTS-REIMAGINED.md`. This REPLACES the current
table/list layout of the contacts page with a two-world layout. It is a structural rebuild
of the presentation, on the light theme already built. **All existing functionality is
preserved** — this is how the same data and controls are arranged and styled, not a change
to what they do.

## The idea

The page splits into two worlds instead of one endless list:

1. **TODAY (the hero)** — a rich panel at the top surfacing the contacts that need action now.
   This is the headline of the page, not a subtle row treatment.
2. **EVERYONE (the grid)** — everyone else, as calm designed cards, scannable but quiet.

The spreadsheet is gone: no columns, no cells, no dropdowns sitting in a grid. Due contacts
are cards you act on; everyone else is a grid of quiet cards. Nothing aligns in a ledger —
that shape is what read as "spreadsheet," so it's what changes.

## TODAY — the hero panel

A panel with a deep navy gradient background (a warm radial glow accent is fine), containing:

- A header: "TODAY" label + "N people need you" (N = count of due/overdue contacts), plus small
  count badges (Overdue N in warm-red, Today N in warm-gold).
- The due/overdue contacts as **rich white cards** in a horizontal row (wrap on narrow widths),
  each card:
  - phase-colored gradient initial tile (rounded square, ~40px)
  - name + company
  - stage pill (filled, light-theme colors) and the due status (warm: "6d overdue" / "Due today")
  - a full-width warm-gradient **action button** naming the next move ("Send follow-up →",
    "Send a reply →") — this fires the same `logAction` / copy path the current row button does
- If nothing is due: a calm empty state in the panel ("You're all caught up — nothing due today"),
  not an empty gradient box.

The hero contains only due/overdue contacts. Its cards are the primary action surface of the page.

## EVERYONE — the grid

Below the hero, a section header ("EVERYONE · 65") with search + filter access, then the rest of
the contacts as cards in a **2-up grid** (responsive: 1 column narrow, 2 wide, could go 3 on very
wide screens):

- Each card: phase-colored initial tile (flat grey for not-started contacts, so worked contacts
  visibly light up), name, title · company, and — only when set — relationship pill, priority
  badge, and a quiet stage tag.
- **Restraint is the rule:** an idle "not started" contact shows almost nothing — name, company,
  a whisper of "Not started." No stage dropdown, no due chip, no action button on idle cards. The
  machinery appears only when relevant. This is the core "app not spreadsheet" move.
- Clicking a card opens the contact record (same navigation as today).
- The change-stage control and inline actions: on the grid cards these move to hover/expand or
  the contact record, rather than sitting on every card. (Decide during build: hover-reveal a
  compact action, or rely on the contact record. Lean: hover-reveal for due-adjacent, record for
  idle.)

## What MUST be preserved (all of it)

This is a reskin of a working screen. Every one of these stays functional:

- **Search** (name/company/title/email) and **all filters** (stage, phase, relationship, segment,
  priority, company, status) — the filter bar stays; it can restyle but not lose capability.
- **Deep-link filters** (`?phase=`, `?status=stalled`, `?relationship=__none__`, etc.) — still drive
  the view. When a filter is active, the two-world split still applies to the filtered set.
- **The frozen-sort invariant** — no re-sort mid-session; urgency is expressed by which world a
  contact is in and by weight, not by rows moving. (In the new layout: a contact being due puts it
  in the hero; that placement is computed on load, not live-reshuffling as you work.)
- **Inline stage change** — preserved (hero cards and/or hover on grid cards); still one call,
  still `logAction` semantics.
- **Bulk select + bulk delete** — the checkbox/select-all and delete-N flow must survive. Decide
  how select works in a card layout (a select affordance on cards, a "select" mode toggle) — don't
  drop the capability. Select-all still means the filtered set.
- **"Who needs me" / due logic** — now literally the hero vs. grid split.
- **Add a contact / Import** buttons.
- **Empty states** — zero contacts, and filtered-to-nothing, both stay graceful.

## Theme & color

Uses the light theme (§6) already built. Specifically:
- Hero panel: navy gradient (deep end of the surface scale), white cards raised on it.
- Grid cards: the card surface (#F7F9FC), initials gradient-tiled by phase.
- Phase-colored initials, filled pills, warm-gradient action buttons, priority badges — all from
  the light-theme meaning tokens. No new hardcoded hex; extend the token set if a gradient needs
  defining, and record it.
- Idle = flat/grey initial + minimal content; active = colored initial + pills. Color literally
  marks who's been worked.

## Build approach

This is a significant rebuild, so:
1. Propose the component structure first — the hero panel, the due-card, the grid-card, how search/
   filter/bulk-select rehome, and how the existing `page.tsx` state (filters from URL, frozen sort,
   selection) maps onto the two-world split. Show me before building.
2. Preserve every test that asserts a capability (search filters, deep-link applies, bulk delete,
   stage change); update the ones that asserted table/row DOM to the new card DOM.
3. Build behind the same route; this replaces the contacts list rendering, not the data layer.
4. This is the theme pilot's real test — if the reimagined page lands, the rest of networking adopts
   both the light theme and this level of design ambition.
