"use client"

// Phase 8e, redesigned per UX-TEMPLATES.md — the "make it yours permanently"
// surface, navigated by who you are writing to rather than by template code.
//
// The counterpart to 8d's scratchpad, and deliberately a DIFFERENT PLACE. The
// Send panel edit is one message to one person and evaporates; this one rewrites
// what every future message of that kind says. Same words on screen, opposite
// blast radius — so they do not share a surface.
//
// The 24-item rail of letter codes is gone. Pick a relationship in plain
// language, see that relationship's three messages as cards, click one to edit
// it in place. The codes remain the storage IDs and remain in ?id= — they are
// simply never rendered, which templateNames.ts exists to guarantee.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { T, headline, fieldLabel } from "../../../../lib/dashboard-theme"
import { authFetch } from "../authFetch"
import { VIEW_LABELS, RELATIONSHIPS, RELATIONSHIP_LABELS } from "../vocab"
import { DEFAULTS_BY_ID, type MergedTemplate } from "../../../../lib/network-tracker/templates"
import {
  PLACEMENT_BY_ID, NAME_BY_ID, TOUCH_DAYS, REPLY_IDS, LINKEDIN_IDS, sequenceIds,
} from "./templateNames"
import { WhoPicker } from "./WhoPicker"
import { TemplateCard } from "./TemplateCard"
import { LibraryGroup } from "./LibraryGroup"

export default function TemplatesPage() {
  // useSearchParams() needs a Suspense boundary, same as Contacts.
  return (
    <Suspense fallback={null}>
      <TemplatesEditor />
    </Suspense>
  )
}

function TemplatesEditor() {
  const [templates, setTemplates] = useState<MergedTemplate[]>([])
  const [profile, setProfile] = useState<Record<string, string | null> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // The expanded template lives in the URL, so the Send panel's "Edit this
  // template" link can point straight at one and a half-written screen is
  // shareable with a coach. It still carries the code — ?id=A2 — because that
  // is the storage ID; what changed is that it now RESOLVES to a relationship
  // and a card rather than to a row in a list.
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const urlId = sp.get("id") ?? ""
  const expandedId = urlId && DEFAULTS_BY_ID[urlId] ? urlId : null

  const load = useCallback(async () => {
    try {
      const [tRes, pRes] = await Promise.all([
        authFetch("/api/network/templates"),
        authFetch("/api/network/profile"),
      ])
      const [tj, pj] = await Promise.all([tRes.json().catch(() => ({})), pRes.json().catch(() => ({}))])
      if (tj?.ok) setTemplates(tj.templates ?? [])
      if (pj?.ok) setProfile(pj.profile ?? {})
      if (!tj?.ok) setError(tj?.error || "Could not load templates.")
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const byId = useMemo(
    () => Object.fromEntries(templates.map((t) => [t.template_id, t])) as Record<string, MergedTemplate>,
    [templates],
  )

  // A deep link decides which relationship is showing, so arriving at ?id=A2
  // and clicking to A2 land in exactly the same place.
  const linkedRelationship = (() => {
    const p = expandedId ? PLACEMENT_BY_ID[expandedId] : undefined
    return p && p.kind === "sequence" ? p.relationship : null
  })()
  const [relationship, setRelationship] = useState<string>(linkedRelationship ?? RELATIONSHIPS[0])
  useEffect(() => {
    if (linkedRelationship) setRelationship(linkedRelationship)
  }, [linkedRelationship])

  const setExpanded = useCallback((id: string | null) => {
    const next = new URLSearchParams(sp.toString())
    if (id) next.set("id", id)
    else next.delete("id")
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [sp, router, pathname])

  const toggle = useCallback((id: string) => {
    setExpanded(expandedId === id ? null : id)
  }, [expandedId, setExpanded])

  // Switching relationship collapses whatever was open: the expanded card
  // belongs to the sequence you were looking at, and carrying it across would
  // leave an editor open under the wrong heading.
  const pickRelationship = useCallback((rel: string) => {
    setRelationship(rel)
    setExpanded(null)
  }, [setExpanded])

  if (loading) return <main style={main}><p style={{ color: T.DIM, fontSize: 13 }}>Loading templates…</p></main>

  const seq = sequenceIds(relationship)

  return (
    <main style={main}>
      <h1 style={headline}>{VIEW_LABELS.templates.heading}</h1>

      <div style={{ ...fieldLabel, textTransform: "uppercase", marginTop: 16 }}>Who are you messaging?</div>
      <WhoPicker value={relationship} onChange={pickRelationship} />

      {error && <div style={{ color: T.ERROR, fontSize: 13, marginTop: 14 }} data-testid="load-error">{error}</div>}

      <section style={{ marginTop: 22 }} data-testid="sequence">
        <div style={{ ...fieldLabel, textTransform: "uppercase" }}>
          {RELATIONSHIP_LABELS[relationship]} · the sequence
        </div>
        <p style={{ color: T.MUTED, fontSize: 12.5, margin: "5px 0 0", maxWidth: 620 }}>
          Three messages, spaced out. Edit any of them and your version is used from then on.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          {seq.map((id, i) => (
            <TemplateCard
              key={id}
              id={id}
              name={NAME_BY_ID[id]}
              step={i + 1}
              day={TOUCH_DAYS[i]}
              template={byId[id] ?? null}
              profile={profile}
              expanded={expandedId === id}
              onToggle={() => toggle(id)}
              onReload={load}
            />
          ))}
        </div>
      </section>

      <LibraryGroup
        heading="Replies"
        hint="You write these once, they work for anyone."
        ids={REPLY_IDS}
        byId={byId}
        profile={profile}
        expandedId={expandedId}
        onToggle={toggle}
        onReload={load}
      />

      <LibraryGroup
        heading="LinkedIn"
        ids={LINKEDIN_IDS}
        byId={byId}
        profile={profile}
        expandedId={expandedId}
        onToggle={toggle}
        onReload={load}
      />
    </main>
  )
}

const main: React.CSSProperties = { padding: 24, margin: "0 auto", maxWidth: 900 }
