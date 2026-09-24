"use client"

// "Add workbook" on the coach's Workbooks tab. Two steps: pick a session
// template, then check the names and create it as a draft.
//
// The preview runs the SAME substitution the server will run (applyTemplate
// from lib/workbook/content) over the SAME template, so what the coach reads is
// what the client will read. It is still only a preview: the browser posts the
// three names, never content, and the server fills its own copy again.
//
// Defaults to the client's view, because that is the thing being checked. The
// coach-only blocks are a toggle away.

import React, { useEffect, useMemo, useState } from "react"
import { applyTemplate, stripCoachOnly, type WorkbookContent } from "../../../../../lib/workbook/content"
import { SectionBlocks, SectionHeader, type FieldApi } from "../../../../../components/workbook/Blocks"
import { wbFetch } from "../../../../../components/workbook/api"

type Summary = { template_id: string; title: string; description: string; sections: number; fields: number }
type Full = Summary & { content: WorkbookContent }

/** The first word of a name, which is what the records can offer. Often wrong
 *  ("Coach: Peri Ginsberg" gives "Coach:"), which is why the boxes are edited. */
function firstWord(s: string): string {
  return (s ?? "").trim().split(/\s+/)[0] ?? ""
}

export function AddWorkbookModal({
  clientId, clientName, onClose, onCreated,
}: {
  clientId: string
  clientName: string
  onClose(): void
  onCreated(workbookId: string): void
}) {
  const [templates, setTemplates] = useState<Summary[] | null>(null)
  /** Step 1 picks, step 2 previews. Selecting is not committing. */
  const [picked, setPicked] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Full | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [firstName, setFirstName] = useState(firstWord(clientName))
  const [fullName, setFullName] = useState((clientName ?? "").trim())
  const [coachFirst, setCoachFirst] = useState("")
  const [showCoachOnly, setShowCoachOnly] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      const { status, body } = await wbFetch<{ templates: Summary[] }>("/api/coach/workbook-templates")
      if (!live) return
      if (status !== 200) { setError(body.error || "Couldn't load the templates."); return }
      setTemplates(body.templates)
      // One template is the common case: select it so Next is live immediately.
      if (body.templates.length === 1) setPicked(body.templates[0].template_id)
    })()
    return () => { live = false }
  }, [])

  // The coach's own first name, as the client will read it. Prefilled from the
  // caller's record, not the principal's: whoever is setting the session up.
  useEffect(() => {
    let live = true
    void (async () => {
      const { status, body } = await wbFetch<{ profile?: { name?: string } }>("/api/profile")
      if (live && status === 200) setCoachFirst(firstWord(body.profile?.name ?? ""))
    })()
    return () => { live = false }
  }, [])

  /** Step 1 to step 2: fetch the picked template's content for the preview. */
  async function next() {
    if (!picked) return
    setError(null)
    setBusy(true)
    const { status, body } = await wbFetch<{ template: Full }>(`/api/coach/workbook-templates/${picked}`)
    setBusy(false)
    if (status !== 200) { setError(body.error || "Couldn't load that template."); return }
    setChosen(body.template)
  }

  async function create() {
    if (!chosen) return
    setBusy(true)
    setError(null)
    const { status, body } = await wbFetch<{ workbook: { id: string } }>(
      `/api/coach/clients/${clientId}/workbooks`,
      {
        method: "POST",
        body: JSON.stringify({
          template_id: chosen.template_id,
          first_name: firstName,
          full_name: fullName,
          coach_first_name: coachFirst,
        }),
      },
    )
    setBusy(false)
    if (status !== 201) { setError(body.error || "Couldn't create the workbook."); return }
    onCreated(body.workbook.id)
  }

  const filled = useMemo(() => {
    if (!chosen) return null
    return applyTemplate(chosen.content, {
      first_name: firstName || "{first_name}",
      full_name: fullName || "{full_name}",
      coach_first_name: coachFirst || "{coach_first_name}",
    })
  }, [chosen, firstName, fullName, coachFirst])

  const shown = filled && !showCoachOnly ? stripCoachOnly(filled) : filled
  const previewApi: FieldApi = {
    editable: false,
    get: () => undefined,
    set: () => {},
    state: () => undefined,
    coachName: coachFirst || "your coach",
    showCoachOnly,
  }
  const ready = !!(firstName.trim() && fullName.trim() && coachFirst.trim())

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add a workbook"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: "fixed", inset: 0, zIndex: 9999, background: "rgba(8,32,63,0.72)",
        display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px",
      }}
    >
      <div
        className="wb-card"
        style={{ width: 720, maxWidth: "100%", maxHeight: "calc(100vh - 80px)", display: "flex", flexDirection: "column", background: "#FCFBF8" }}
      >
        <div style={{ padding: "28px 32px 0", display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="wb-eyebrow">{chosen ? "Check it over" : "Add a workbook"}</span>
          <h2 className="wb-h2" style={{ margin: 0 }}>{chosen ? chosen.title : `A new workbook for ${clientName}`}</h2>
          {error && <p className="wb-warn" role="alert">{error}</p>}
        </div>

        <div style={{ padding: "20px 32px", overflowY: "auto", flex: 1 }}>
          {!chosen && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {!templates && !error && <p className="wb-p wb-muted">Loading</p>}
              {templates?.length === 0 && <p className="wb-p wb-muted">There are no session templates yet.</p>}
              {templates?.map((t) => {
                const on = picked === t.template_id
                return (
                  <button
                    key={t.template_id} type="button" role="radio" aria-checked={on}
                    onClick={() => setPicked(t.template_id)}
                    onDoubleClick={() => void next()}
                    className="wb-card-soft"
                    style={{
                      textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit",
                      // Selected has to be obvious without colour alone: a heavier
                      // border, a tinted fill, and the word "Selected".
                      border: on ? "2px solid #009BFF" : "1px solid #DCE1E8",
                      background: on ? "#F2F9FF" : "#fff",
                      padding: on ? 17 : 18,
                    }}
                  >
                    <div className="wb-card-head">
                      <span className="wb-serif" style={{ fontSize: 22, fontWeight: 600 }}>{t.title}</span>
                      {on && <span className="wb-tag ok">Selected</span>}
                    </div>
                    <span className="wb-p" style={{ margin: 0 }}>{t.description}</span>
                    <span className="wb-muted" style={{ fontSize: 14 }}>
                      {t.sections} section{t.sections === 1 ? "" : "s"}, {t.fields} write-in{t.fields === 1 ? "" : "s"}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {chosen && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                <label className="wb-label" style={{ flex: "1 1 180px", display: "flex", flexDirection: "column", gap: 6 }}>
                  What you call them
                  <input className="wb-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </label>
                <label className="wb-label" style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: 6 }}>
                  Their full name
                  <input className="wb-input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </label>
                <label className="wb-label" style={{ flex: "1 1 180px", display: "flex", flexDirection: "column", gap: 6 }}>
                  Your first name, as they read it
                  <input className="wb-input" value={coachFirst} onChange={(e) => setCoachFirst(e.target.value)} />
                </label>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={showCoachOnly} onChange={(e) => setShowCoachOnly(e.target.checked)} />
                <span className="wb-muted" style={{ fontSize: 14 }}>
                  Show your coach-only notes. The client never sees these.
                </span>
              </label>

              <div className="wb-rule" />
              {shown?.sections.map((s, i) => (
                <div key={s.id}>
                  <SectionHeader section={s} total={shown.sections.length} />
                  <SectionBlocks api={previewApi} section={s} />
                  {i < shown.sections.length - 1 && <div className="wb-rule" />}
                </div>
              ))}
              <p className="wb-muted" style={{ fontSize: 14 }}>
                The 1-hour summary is built from their answers, so there is nothing to preview there yet.
              </p>
            </div>
          )}
        </div>

        <div style={{ padding: "16px 32px 28px", display: "flex", gap: 12, justifyContent: "flex-end", borderTop: "1px solid #DCE1E8" }}>
          <button type="button" className="wb-btn" onClick={chosen ? () => setChosen(null) : onClose} disabled={busy}>
            {chosen ? "Back" : "Cancel"}
          </button>
          {chosen ? (
            <button type="button" className="wb-btn wb-btn-solid" onClick={() => void create()} disabled={busy || !ready}>
              {busy ? "Creating" : "Create draft"}
            </button>
          ) : (
            <button type="button" className="wb-btn wb-btn-solid" onClick={() => void next()} disabled={busy || !picked}>
              {busy ? "Opening" : "Next"}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
