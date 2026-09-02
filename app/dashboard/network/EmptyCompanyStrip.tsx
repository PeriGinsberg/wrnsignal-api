"use client"

// COMPANIES WITH NOBODY AT THEM YET.
//
// A board fills with companies faster than it fills with people: production has
// 38 companies and 27 contacts, and 20 of those companies have no contact at
// all. Before this, that gap was invisible, because companies lived on their own
// tab and the roster lived on another. The strip is the one place the two facts
// meet, and it exists to turn "a company you saved" into "a person you could
// talk to", which is the only thing the board is for.
//
// A PROMPT, NOT A WARNING. No count, no badge, no red. It offers an action and
// a way to say not now, and if the user says not now it does not ask again.
//
// Dismissal is per viewer and per device; see lib/network-tracker/stripDismissal
// for why, and for what that costs. It prunes on every render against the
// companies that are STILL empty, so a company that loses its last contact
// becomes a fresh question rather than staying silently dismissed.

import { useEffect, useMemo, useState } from "react"
import { LIGHT as S } from "../../../lib/theme/surfaces"
import { getSupabaseBrowser } from "../../../lib/supabase-browser"
import { dismissedFor, dismiss, pruneTo } from "../../../lib/network-tracker/stripDismissal"
import { CompaniesIcon } from "../../../components/icons"

export type EmptyCompany = { id: string; name: string }

export function EmptyCompanyStrip({
  companies, onAddContact,
}: {
  /**
   * Companies with contact_count === 0, or NULL while that is still loading.
   *
   * THE DISTINCTION IS LOAD-BEARING, and getting it wrong wiped every
   * dismissal on every page load: an empty ARRAY means "every company has
   * somebody, forget the dismissals", which is correct, and the list simply
   * not having arrived yet looked identical. Null is the only way to say "I do
   * not know yet", so it is a separate type rather than a second boolean the
   * caller could forget to pass.
   */
  companies: EmptyCompany[] | null
  /** Opens the add-contact form with this company prefilled. */
  onAddContact: (companyName: string) => void
}) {
  const [viewerId, setViewerId] = useState<string>("")
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  // The account, for scoping. The session user id is stable and already in the
  // browser, so this costs no request.
  useEffect(() => {
    let alive = true
    // getSupabaseBrowser() THROWS SYNCHRONOUSLY when the env vars are absent,
    // so the try must wrap the call and not just the promise. A strip is a
    // prompt: it may decline to render, it may not take the roster down with
    // it. Without the viewerId it simply shows everything and dismisses
    // nothing, which is a worse strip and a working page.
    try {
      getSupabaseBrowser().auth.getSession().then(({ data }) => {
        const id = data.session?.user?.id ?? ""
        if (alive && id) setViewerId(id)
      }).catch(() => {})
    } catch {
      // No client available. Carry on undismissable.
    }
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!viewerId) return
    // NEVER PRUNE AGAINST AN UNLOADED LIST. pruneTo keeps only the ids it is
    // given, so calling it with [] before the fetch returns deletes the store.
    if (companies === null) {
      setHidden(dismissedFor(viewerId))
      return
    }
    setHidden(pruneTo(viewerId, companies.map((c) => c.id)))
  }, [viewerId, companies])

  const shown = useMemo(
    () => (companies ?? []).filter((c) => !hidden.has(c.id)),
    [companies, hidden],
  )

  // Nothing to prompt, no strip. Deliberately not an empty state: a board with
  // a person at every company is a board doing well, and does not need telling.
  if (shown.length === 0) return null

  return (
    <div style={wrap} data-testid="empty-company-strip">
      <div style={head}>
        <CompaniesIcon size={17} />
        <span>
          {shown.length === 1
            ? "One company on your board has nobody at it yet"
            : `${shown.length} companies on your board have nobody at them yet`}
        </span>
      </div>

      <div style={row}>
        {shown.map((co) => (
          <span key={co.id} style={chip} data-testid="empty-company-chip">
            <button
              type="button"
              onClick={() => onAddContact(co.name)}
              style={chipAdd}
              title={`Add someone at ${co.name}`}
            >
              {co.name}
              <span style={chipPlus} aria-hidden="true">+</span>
            </button>
            <button
              type="button"
              onClick={() => { if (viewerId) setHidden(dismiss(viewerId, co.id)) }}
              style={chipX}
              aria-label={`Dismiss ${co.name}`}
              title="Not now"
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}

const wrap: React.CSSProperties = {
  background: S.well,
  border: `1px solid ${S.borderSoft}`,
  borderRadius: 14,
  padding: "13px 15px",
  marginBottom: 16,
}

const head: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
  fontWeight: 700,
  color: S.text.secondary,
  marginBottom: 10,
}

const row: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
}

// The chip is two buttons sharing a border: the name adds someone, the × says
// not now. Split so the dismissal can never be hit by someone aiming at the
// company, which on a wrapped row of small targets is a real risk.
const chip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "stretch",
  background: S.card,
  border: `1px solid ${S.border}`,
  borderRadius: 999,
  overflow: "hidden",
}

const chipAdd: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: "7px 6px 7px 13px",
  fontSize: 13,
  fontWeight: 700,
  fontFamily: "inherit",
  color: S.text.primary,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  whiteSpace: "nowrap",
}

const chipPlus: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 800,
  color: S.action.quietInk,
  lineHeight: 1,
}

const chipX: React.CSSProperties = {
  background: "none",
  border: "none",
  borderLeft: `1px solid ${S.borderSoft}`,
  padding: "0 10px",
  fontSize: 15,
  lineHeight: 1,
  fontFamily: "inherit",
  color: S.text.dim,
  cursor: "pointer",
}
