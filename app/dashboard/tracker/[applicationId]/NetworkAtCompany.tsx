"use client"

// Your network at this company.
//
// The other half of the link the contact record reads. This is the surface that
// CREATES it, and on day one it is the only one anyone will see doing anything,
// because every application row starts unlinked: 234 on dev, 993 on prod.
//
// FOUR STATES, and the unlinked ones are the common pair for a long time:
//
//   unlinked, name matches a board company   offer to link it, named
//   unlinked, no match                       offer to add it to the board
//   linked, no contacts yet                  the loudest state. A company on
//                                            the board with nobody at it is
//                                            the one thing here worth fixing
//   linked, with contacts                    the people, their stage, and a
//                                            quieter way to add another
//
// ADD IS IN BOTH LINKED STATES. It was in the empty one only, so a company with
// one contact offered no way to add a second and the user had to leave and
// retype the company — the very thing the empty state's link exists to prevent.
// Found by a tester on a seeded company with two contacts.
//
// A NAME MATCH ONLY EVER SUGGESTS. Never auto-links. The comparison is exact
// case-insensitive equality, the same one lower(name) makes in
// uq_network_companies_name, with no fuzzy matching and no stripping of Inc or
// Ltd. A suggestion that is wrong costs more than no suggestion, because the
// user confirms it without reading. Measured on dev: 4 of 234 applications
// exact-match a board company, so the match branch is rare and the add branch
// is the normal one.
//
// THE LINK IS CORRECTABLE FROM HERE. Unlink is a quiet text control, not peach:
// peach is for the action the screen wants you to take, and undoing a mistake
// is not that. But it has to exist on the same screen that can make the
// mistake, which is why it shipped before this did.

import { useCallback, useEffect, useState } from "react"
import {
  LIGHT as S, PHASE_MEANING, action as actionStyle, status as statusStyle,
  surfaceCard, type MeaningKey,
} from "../../../../lib/theme/surfaces"
import { authFetch } from "../../network/authFetch"
import { STAGE_LABELS, STAGE_PHASE } from "../../network/vocab"
import { Select } from "../controls"

type BoardCompany = { id: string; name: string; contact_count?: number }
type BoardContact = {
  id: string
  first_name: string
  last_name: string
  title: string | null
  stage: string
}

function stageMeaning(stage: string): MeaningKey {
  return PHASE_MEANING[STAGE_PHASE[stage] ?? "idle"]
}

const label: React.CSSProperties = {
  fontSize: 12, fontWeight: 800, letterSpacing: 1.4,
  textTransform: "uppercase", color: S.text.muted,
}

export function NetworkAtCompany({
  applicationId, companyName, jobTitle, companyId, onChanged,
}: {
  applicationId: string
  companyName: string
  /** Only used to name this application on the return button. */
  jobTitle: string
  /** Null until the user links it, which is every row on day one. */
  companyId: string | null
  onChanged: () => void
}) {
  const [companies, setCompanies] = useState<BoardCompany[]>([])
  const [contacts, setContacts] = useState<BoardContact[]>([])
  const [picked, setPicked] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  /**
   * A FAILED READ IS NOT AN EMPTY BOARD, and conflating them was a real bug
   * caught by the test below it. With only `err` set, `contacts` stayed `[]`
   * and the linked branch rendered "No one at Globex yet" directly above the
   * line saying the board could not be loaded. Two contradictory statements,
   * and the confident one was the false one.
   */
  const [loadFailed, setLoadFailed] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    setLoadFailed(false)
    try {
      if (companyId) {
        const res = await authFetch(`/api/network/contacts?company_id=${encodeURIComponent(companyId)}`)
        const j = await res.json().catch(() => ({}))
        if (!res.ok || !j?.ok) throw new Error("contacts")
        setContacts(j.contacts ?? [])
      } else {
        const res = await authFetch("/api/network/companies")
        const j = await res.json().catch(() => ({}))
        if (!res.ok || !j?.ok) throw new Error("companies")
        setCompanies(j.companies ?? [])
      }
    } catch {
      // A failed read here must not read as "nobody works there". Same rule as
      // AppliedHere: the silence would be indistinguishable from the answer.
      setErr("We couldn't load your networking board.")
      setLoadFailed(true)
    } finally {
      setLoaded(true)
    }
  }, [companyId])

  useEffect(() => { void load() }, [load])

  /**
   * One endpoint for all three writes. `company_id: null` unlinks, a string
   * links to a chosen company, a name finds-or-creates. The route distinguishes
   * an absent company_id from an explicit null by key presence, so the shapes
   * below are not interchangeable.
   */
  async function post(body: Record<string, unknown>) {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      const res = await authFetch("/api/network/companies/link-application", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ application_id: applicationId, ...body }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || "That didn't save.")
      onChanged()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // EXACT, case-insensitive. The same comparison the unique index makes.
  const match = companies.find(
    (c) => c.name.trim().toLowerCase() === (companyName || "").trim().toLowerCase(),
  )

  /**
   * The add-contact link, carrying everything the next screen needs so the
   * company is not forgotten and the loop can be closed.
   *
   *   add=1      open the form
   *   company    prefills the field. The NAME, not the id: the contacts POST
   *              resolves a company by name through matchOrCreateCompany and
   *              has no company_id input, and the name we send is the linked
   *              row's own, so it resolves back to exactly that row.
   *   return     where the success panel points
   *   label      what that button says. Named, because "back to your
   *              application" is too vague after three screens.
   */
  const addContactHref = (() => {
    const p = new URLSearchParams({ add: "1" })
    if (companyName.trim()) p.set("company", companyName.trim())
    p.set("return", `/dashboard/tracker/${applicationId}`)
    const label = [jobTitle, companyName].map((s) => (s || "").trim()).filter(Boolean).join(" at ")
    if (label) p.set("label", label)
    return `/dashboard/network/contacts?${p.toString()}`
  })()

  const shell = (children: React.ReactNode) => (
    <section
      data-testid="network-at-company"
      style={{ ...surfaceCard(S), borderRadius: 14, padding: "18px 22px", marginTop: 14 }}
    >
      <div style={label}>Your network at {companyName || "this company"}</div>
      {children}
      {err && (
        <p style={{ fontSize: 13.5, fontWeight: 700, color: S.meaning.error.ink, margin: "12px 0 0" }}>
          {err}
        </p>
      )}
    </section>
  )

  if (!loaded) return null

  // The read failed, so we do not know what is there. Say only that. Every
  // branch below asserts something about the board, and asserting anything on
  // no data is how "we could not load this" ends up sitting under "nobody
  // works there".
  if (loadFailed) return shell(null)

  // ── Linked ────────────────────────────────────────────────────────────────
  if (companyId) {
    return shell(
      <>
        {contacts.length === 0 ? (
          // The loudest state on purpose. A company on the board with nobody at
          // it is the one thing on this card worth fixing, and it is the whole
          // point of linking in the first place.
          <>
            <p style={{ fontSize: 14.5, color: S.text.muted, lineHeight: "21px", margin: "10px 0 0" }}>
              No one at {companyName} yet. One person inside is worth more than ten applications.
            </p>
            {/* CARRIES THE COMPANY, AND THE WAY BACK. This used to be a bare
                link to the contacts list, so the screen that knew the company
                forgot it one navigation later and the user had to retype it,
                then find their own way back. The form reads all four params. */}
            <a
              href={addContactHref}
              data-testid="add-contact-here"
              style={{
                ...actionStyle(S, "primary"), textDecoration: "none", display: "inline-block",
                marginTop: 14, borderRadius: 10, padding: "10px 18px", fontSize: 14,
              }}
            >
              Add someone at {companyName} →
            </a>
          </>
        ) : (
          <>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
            {contacts.map((c) => {
              const st = statusStyle(S, stageMeaning(c.stage))
              const name = `${c.first_name} ${c.last_name}`.trim()
              return (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <a
                    href={`/dashboard/network/contacts/${c.id}`}
                    style={{ fontSize: 14.5, fontWeight: 700, color: S.action.quietInk, textDecoration: "none" }}
                  >
                    {name || "Unnamed contact"}
                  </a>
                  {c.title && (
                    <span style={{ fontSize: 13.5, color: S.text.muted, minWidth: 0 }}>{c.title}</span>
                  )}
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <span style={st.dot} />
                    <span style={{ ...st.text, fontSize: 13.5, whiteSpace: "nowrap" }}>
                      {STAGE_LABELS[c.stage] ?? c.stage}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
          {/* ONE CONTACT IS NOT DONE. This branch used to render the people and
              nothing else, so the moment a company had a single contact the
              only way to add a second was to leave for the contacts list and
              retype the company — the exact retyping the empty state was built
              to avoid. Same href, same four params; quieter, because here the
              people are the content and this is not the headline. */}
          <a
            href={addContactHref}
            data-testid="add-contact-here"
            style={{
              display: "inline-block", marginTop: 14, fontSize: 13.5,
              fontWeight: 700, color: S.action.quietInk, textDecoration: "none",
            }}
          >
            Add someone else at {companyName} →
          </a>
          </>
        )}

        {/* Quiet, never peach. Undoing a mistake is not the action the screen
            wants, but it has to be reachable from the screen that made it.
            SAY THE WORD "UNLINK". This read "Not the right company", which
            describes the situation rather than naming the action, and a tester
            hunting for "unlink" scanned straight past it on a screen where it
            was rendered and visible. Quiet is about weight, not vocabulary. */}
        <button
          onClick={() => void post({ company_id: null })}
          disabled={busy}
          data-testid="unlink-company"
          style={{
            background: "none", border: "none", padding: "14px 0 0",
            color: S.action.quietInk, fontSize: 13.5, fontWeight: 700,
            cursor: busy ? "default" : "pointer", fontFamily: "inherit", opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Working…" : "Unlink"}
        </button>
      </>,
    )
  }

  // ── Unlinked, and the name matches something already on the board ─────────
  if (match) {
    return shell(
      <>
        <p style={{ fontSize: 14.5, color: S.text.muted, lineHeight: "21px", margin: "10px 0 0" }}>
          {match.name} is already on your networking board. Link them and you&apos;ll see your
          contacts there from here.
        </p>
        <button
          onClick={() => void post({ company_id: match.id })}
          disabled={busy}
          data-testid="link-existing"
          style={{
            ...actionStyle(S, "primary"), marginTop: 14, borderRadius: 10,
            padding: "10px 18px", fontSize: 14, fontFamily: "inherit",
            cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Linking…" : `Link to ${match.name}`}
        </button>
      </>,
    )
  }

  // ── Unlinked, no match. The normal state, 230 of 234 rows on dev ──────────
  return shell(
    <>
      <p style={{ fontSize: 14.5, color: S.text.muted, lineHeight: "21px", margin: "10px 0 0" }}>
        Not on your networking board yet. Add it and any contacts you have there show up here.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 14, flexWrap: "wrap" }}>
        <button
          onClick={() => void post({ company_name: companyName })}
          disabled={busy || !companyName.trim()}
          data-testid="add-company"
          style={{
            ...actionStyle(S, "primary"), borderRadius: 10, padding: "10px 18px",
            fontSize: 14, fontFamily: "inherit",
            cursor: busy ? "default" : "pointer", opacity: busy || !companyName.trim() ? 0.6 : 1,
          }}
        >
          {busy ? "Adding…" : `Add ${companyName} to your board`}
        </button>

        {/* The escape hatch for a company whose name here does not match the
            board: "Globex Corp" on one side and "Globex" on the other. Without
            it the only option would be creating a near-duplicate. */}
        {companies.length > 0 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13.5, color: S.text.dim }}>or link to</span>
            <span style={{ minWidth: 200 }}>
              <Select
                value={picked}
                ariaLabel="Link to a company already on your board"
                options={[{ value: "", label: "Pick a company" },
                  ...companies.map((c) => ({ value: c.id, label: c.name }))]}
                onChange={(v) => {
                  setPicked(v)
                  if (v) void post({ company_id: v })
                }}
              />
            </span>
          </span>
        )}
      </div>
    </>,
  )
}
