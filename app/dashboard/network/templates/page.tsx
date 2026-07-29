"use client"

// Phase 8e — the template editor. The "make it yours permanently" surface.
//
// The counterpart to 8d's scratchpad, and deliberately a DIFFERENT PLACE. The
// Send panel edit is one message to one person and evaporates; this one rewrites
// what every future message of that kind says. Same words on screen, opposite
// blast radius — so they do not share a surface.
//
// Saving is the existing PATCH; "revert to default" is the existing DELETE (no
// row IS the default). Saving the default back verbatim is treated as a revert
// by the route, so a client who edits and undoes is not left permanently
// marked as customised.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { T, card, headline, fieldLabel, btnPrimary } from "../../../../lib/dashboard-theme"
import { authFetch } from "../authFetch"
import { VIEW_LABELS } from "../vocab"
import {
  renderTemplate, extractVariables, classifyVariable, DEFAULTS_BY_ID,
  type MergedTemplate,
} from "../../../../lib/network-tracker/templates"
import { TEMPLATE_GROUPS, SAMPLE_CONTACT, droppedVariables } from "./groups"

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
  const [busy, setBusy] = useState<null | "save" | "revert">(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // The selected template lives in the URL, so the Send panel's "Edit this
  // template" link can point straight at one and a half-written screen is
  // shareable with a coach.
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const urlId = sp.get("id") ?? ""

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

  // Default to the first template so the editor is never an empty right-hand
  // void on arrival.
  const activeId = urlId && DEFAULTS_BY_ID[urlId] ? urlId : TEMPLATE_GROUPS[0].ids[0]
  const active = byId[activeId] ?? null

  const select = useCallback((id: string) => {
    const next = new URLSearchParams(sp.toString())
    next.set("id", id)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }, [sp, router, pathname])

  // The edit in progress. null = untouched, so the box shows what is saved.
  const [draft, setDraft] = useState<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  // Switching templates abandons an unsaved edit rather than carrying it to the
  // next body, same rule as the scratchpad. Keyed on the SAVED body too, so a
  // successful save re-baselines instead of leaving the draft looking dirty.
  useEffect(() => { setDraft(null); setNotice(null) }, [activeId, active?.body])

  const body = draft ?? active?.body ?? ""
  const dirty = draft !== null && active != null && draft !== active.body
  const dropped = useMemo(
    () => (dirty ? droppedVariables(activeId, body) : []),
    [dirty, activeId, body],
  )

  // Live preview: the real profile, a fixed sample contact.
  const preview = useMemo(
    () => renderTemplate(body, profile, SAMPLE_CONTACT),
    [body, profile],
  )

  // Palette insert at the caret, so nobody types a bracket by hand.
  const insert = useCallback((token: string) => {
    const ta = taRef.current
    const text = `[${token}]`
    if (!ta) { setDraft((d) => (d ?? active?.body ?? "") + text); return }
    const start = ta.selectionStart ?? ta.value.length
    const end = ta.selectionEnd ?? start
    const current = ta.value
    const next = current.slice(0, start) + text + current.slice(end)
    setDraft(next)
    // Put the caret after what we just inserted rather than at the end, so a
    // second insert does not land somewhere the writer is not looking.
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(start + text.length, start + text.length)
    })
  }, [active])

  async function save() {
    if (!active || !dirty) return
    setBusy("save"); setError(null); setNotice(null)
    try {
      const res = await authFetch(`/api/network/templates/${activeId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Save failed (${res.status})`)
      setDraft(null)
      await load()
      // The route turns "saved the default back" into a revert; say which happened.
      setNotice(j?.reverted ? `${activeId} is back to the default.` : `${activeId} saved.`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function revert() {
    if (!active) return
    setBusy("revert"); setError(null); setNotice(null)
    try {
      const res = await authFetch(`/api/network/templates/${activeId}`, { method: "DELETE" })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Revert failed (${res.status})`)
      setDraft(null)
      await load()
      setNotice(`${activeId} is back to the default.`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <main style={main}><p style={{ color: T.DIM, fontSize: 13 }}>Loading templates…</p></main>

  return (
    <main style={main}>
      <h1 style={headline}>{VIEW_LABELS.templates.heading}</h1>
      <p style={{ color: T.MUTED, fontSize: 13, marginTop: 6, maxWidth: 760 }}>
        Edit any of these and your version is used from then on. Changes here apply to every
        future message of that kind — to change one message for one person, edit it in the
        Send panel on their record instead.
      </p>

      {error && <div style={{ color: T.ERROR, fontSize: 13, marginTop: 14 }} data-testid="editor-error">{error}</div>}

      <div style={{ display: "flex", gap: 18, marginTop: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* ── LIST ─────────────────────────────────────────────── */}
        <nav style={{ ...card, padding: "12px 10px", flex: "0 0 224px", minWidth: 200 }} aria-label="Templates">
          {TEMPLATE_GROUPS.map((g) => (
            <div key={g.heading} style={{ marginBottom: 12 }}>
              <div style={{ ...fieldLabel, textTransform: "uppercase", padding: "0 8px 5px" }}>
                {g.heading}
                {g.hint && <span style={{ color: T.DIM, fontWeight: 600, textTransform: "none" }}> · {g.hint}</span>}
              </div>
              {g.ids.map((id) => {
                const t = byId[id]
                const on = id === activeId
                return (
                  <button
                    key={id}
                    onClick={() => select(id)}
                    aria-current={on ? "true" : undefined}
                    data-testid={`pick-${id}`}
                    style={{
                      display: "flex", width: "100%", gap: 8, alignItems: "baseline", textAlign: "left",
                      background: on ? T.NAV_ACTIVE_BG : "none",
                      border: `1px solid ${on ? T.NAV_ACTIVE_BORDER : "transparent"}`,
                      borderRadius: 8, padding: "6px 8px", cursor: "pointer", color: T.TEXT, fontSize: 12,
                    }}
                  >
                    <span style={{ fontWeight: 900, color: on ? T.WRN_ORANGE : T.MUTED, minWidth: 20 }}>{id}</span>
                    <span style={{ flex: 1, color: on ? T.TEXT : T.MUTED }}>{t?.label ?? DEFAULTS_BY_ID[id]?.label}</span>
                    {/* One dot, no legend: an edited template is the exception, and
                        the editor tells you which it is the moment you open it. */}
                    {t?.source === "override" && (
                      <span title="Edited" data-testid={`edited-dot-${id}`}
                        style={{ color: T.WRN_ORANGE, fontSize: 14, lineHeight: "12px" }}>•</span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        {/* ── EDITOR + palette + warning ────────────────────────── */}
        <section style={{ ...card, padding: "16px 18px", flex: "1 1 380px", minWidth: 320 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <span style={{ color: T.TEXT, fontSize: 13, fontWeight: 900 }} data-testid="editing-id">{activeId}</span>
            <span style={{ color: T.MUTED, fontSize: 12, flex: 1 }}>{active?.label}</span>
            <span data-testid="source-badge" style={{
              fontSize: 10.5, fontWeight: 900, letterSpacing: 0.3, textTransform: "uppercase",
              color: active?.source === "override" ? T.WRN_ORANGE : T.DIM,
            }}>
              {active?.source === "override" ? "Your version" : "Default"}
            </span>
          </div>

          <textarea
            ref={taRef}
            data-testid="template-body"
            aria-label="Template body"
            value={body}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(20, Math.max(7, body.split("\n").length + 2))}
            style={{
              display: "block", width: "100%", boxSizing: "border-box", resize: "vertical",
              fontFamily: "inherit", fontSize: 13, lineHeight: "20px", color: T.TEXT,
              background: T.GLASS, border: `1px solid ${dirty ? T.WRN_BLUE : T.BORDER_SOFT}`,
              borderRadius: 12, padding: "12px 14px",
            }}
          />

          <Palette onInsert={insert} />

          {dropped.length > 0 && (
            // Between editor and preview, where the eye already is. A warning,
            // never a block — dropping a variable can be exactly what someone
            // means, and refusing the save would just push them to stop editing.
            <div data-testid="dropped-warning" style={{
              background: T.WARNING_BG, border: "1px solid rgba(254,176,106,0.35)", borderRadius: 10,
              padding: "9px 12px", marginTop: 12, color: T.TEXT, fontSize: 12, lineHeight: "18px",
            }}>
              This drops {dropped.map((v) => `[${v}]`).join(", ")}, which the default filled in
              automatically. Fine if you meant it — but check the preview for anything you have
              written in by hand.
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={() => void save()} disabled={!dirty || busy !== null}
              style={{ ...btnPrimary, padding: "9px 16px", fontSize: 12.5, opacity: dirty ? 1 : 0.45 }}>
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            {dirty && (
              <button onClick={() => setDraft(null)} style={ghost} data-testid="discard">Discard changes</button>
            )}
            {active?.source === "override" && !dirty && (
              <button onClick={() => void revert()} disabled={busy !== null} style={ghost} data-testid="revert">
                {busy === "revert" ? "Reverting…" : "Revert to default"}
              </button>
            )}
            {notice && <span data-testid="editor-notice" style={{ color: T.SUCCESS, fontSize: 12, fontWeight: 700 }}>{notice}</span>}
          </div>
        </section>

        {/* ── PREVIEW ───────────────────────────────────────────── */}
        <aside style={{ ...card, padding: "16px 18px", flex: "1 1 320px", minWidth: 300 }}>
          <div style={{ ...fieldLabel, textTransform: "uppercase", marginBottom: 4 }}>Preview</div>
          <div style={{ color: T.DIM, fontSize: 11.5, marginBottom: 10 }}>
            Your profile, sample contact: {SAMPLE_CONTACT.display}
          </div>
          <pre data-testid="preview" style={{
            whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, lineHeight: "20px",
            color: T.TEXT, background: T.GLASS, border: `1px solid ${T.BORDER_SOFT}`,
            borderRadius: 12, padding: "12px 14px", margin: 0,
          }}>{preview.text}</pre>

          {preview.unresolved.length > 0 && (
            <p data-testid="preview-unresolved" style={{ color: T.MUTED, fontSize: 11.5, marginTop: 10, lineHeight: "17px" }}>
              Blank in the preview because your profile has no value yet:{" "}
              {preview.unresolved.map((v) => `[${v}]`).join(", ")}.
            </p>
          )}
          {preview.toFill.length > 0 && (
            <p data-testid="preview-tofill" style={{ color: T.MUTED, fontSize: 11.5, marginTop: 8, lineHeight: "17px" }}>
              Left for you to write at send time: {preview.toFill.map((v) => `[${v}]`).join(", ")}.
            </p>
          )}
        </aside>
      </div>
    </main>
  )
}

// Grouped by where the value comes from, because that is the distinction that
// matters when writing: two of these fill themselves in and one never will.
function Palette({ onInsert }: { onInsert: (token: string) => void }) {
  const groups = useMemo(() => {
    // Derived from the DEFAULTS, so a variable used by a template can never be
    // missing from the palette that is supposed to offer it.
    const all = new Set<string>()
    for (const d of Object.values(DEFAULTS_BY_ID)) extractVariables(d.body).forEach((v) => all.add(v))
    const out: Record<"profile" | "contact" | "fill", string[]> = { profile: [], contact: [], fill: [] }
    for (const v of all) out[classifyVariable(v)].push(v)
    for (const k of Object.keys(out) as (keyof typeof out)[]) out[k].sort()
    return out
  }, [])

  const SECTIONS = [
    { key: "profile" as const, label: "From your profile" },
    { key: "contact" as const, label: "From the contact" },
    { key: "fill" as const, label: "Fill in when you send" },
  ]

  return (
    <div style={{ marginTop: 12 }} data-testid="palette">
      {SECTIONS.map(({ key, label }) => (
        <div key={key} style={{ marginBottom: 8 }}>
          <div style={{ ...fieldLabel, textTransform: "uppercase", marginBottom: 5 }}>{label}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {groups[key].map((v) => (
              <button key={v} onClick={() => onInsert(v)} data-testid={`chip-${v}`} title={`Insert [${v}]`}
                style={{
                  background: T.GLASS, border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 7,
                  padding: "4px 8px", fontSize: 11, fontWeight: 700, color: T.MUTED, cursor: "pointer",
                  fontFamily: "inherit",
                }}>
                [{v}]
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

const main: React.CSSProperties = { padding: 24, margin: "0 auto", maxWidth: 1400 }
const ghost: React.CSSProperties = {
  background: "none", border: "none", color: T.DIM, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0,
}
