// lib/resumeWorkshop/exportMarkdown.ts
//
// The workshop as one Markdown file, for uploading to Claude with the Teams
// transcript and the original resume.
//
// EVERYTHING, WORD FOR WORD. Every tab appears, even empty ones ("No entries").
// Every entry's title and notes, every Quick Capture note whether unassigned,
// copied or moved, and the general notes. The coach's text is copied exactly:
// nothing is summarised, trimmed, reworded or dropped. Text imported from the
// resume is labelled as such and kept apart from the coach's notes, so the
// reader can tell what the client's resume said from what the coach heard.

import { TABS, TAB_LABEL, type WorkshopTab } from "./model"

export type ExportEntry = {
  id: string
  tab: WorkshopTab
  title: string
  notes: string
  source: "coach" | "resume"
  resume_excerpt: string | null
}
export type ExportCapture = {
  id: string
  body: string
  copied_to_entry_id: string | null
  moved_to_entry_id: string | null
  created_at: string
}
export type ExportInput = {
  clientName: string
  coachName: string | null
  workshopDate: string
  exportedAt: string
  generalNotes: string
  entries: ExportEntry[]
  captures: ExportCapture[]
}

const blockquote = (text: string) => text.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n")

export function exportFileName(clientName: string, workshopDate: string): string {
  const slug = clientName.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-") || "client"
  return `Resume-Workshop-${slug}-${workshopDate}.md`
}

export function workshopMarkdown(x: ExportInput): string {
  const out: string[] = []
  const entryTitle = (e: ExportEntry) => e.title.trim() || "(untitled entry)"
  const byId = new Map(x.entries.map((e) => [e.id, e]))

  out.push(`# Resume Workshop Notes: ${x.clientName}`)
  out.push("")
  out.push(`- Client: ${x.clientName}`)
  out.push(`- Workshop date: ${x.workshopDate}`)
  if (x.coachName) out.push(`- Coach: ${x.coachName}`)
  out.push(`- Exported: ${x.exportedAt}`)
  out.push("")
  out.push("Coach's live notes from the Resume Workshop, exported from SIGNAL without changes. Text marked \"From the original resume\" was imported from the resume on file; everything else was written by the coach during the workshop.")
  out.push("")

  out.push("## General Workshop Notes")
  out.push("")
  out.push(x.generalNotes.trim() ? x.generalNotes : "_No general notes._")
  out.push("")

  TABS.forEach((tab, i) => {
    out.push(`## ${i + 1}. ${TAB_LABEL[tab]}`)
    out.push("")
    const entries = x.entries.filter((e) => e.tab === tab)
    if (!entries.length) {
      out.push("_No entries._")
      out.push("")
      return
    }
    for (const e of entries) {
      out.push(`### ${entryTitle(e)}`)
      out.push("")
      if (e.resume_excerpt?.trim()) {
        out.push("**From the original resume (imported, not coach notes):**")
        out.push("")
        out.push(blockquote(e.resume_excerpt))
        out.push("")
      }
      out.push("**Coach notes:**")
      out.push("")
      out.push(e.notes.trim() ? e.notes : "_No notes._")
      out.push("")
    }
  })

  out.push("## Quick Capture")
  out.push("")
  if (!x.captures.length) {
    out.push("_No Quick Capture notes._")
    out.push("")
  }
  const groups: [string, ExportCapture[]][] = [
    ["Unassigned", x.captures.filter((c) => !c.moved_to_entry_id && !c.copied_to_entry_id)],
    ["Copied into an entry (also kept here)", x.captures.filter((c) => c.copied_to_entry_id && !c.moved_to_entry_id)],
    ["Moved into an entry", x.captures.filter((c) => c.moved_to_entry_id)],
  ]
  for (const [label, list] of groups) {
    if (!list.length) continue
    out.push(`### ${label}`)
    out.push("")
    list.forEach((c, n) => {
      const target = byId.get(c.moved_to_entry_id ?? c.copied_to_entry_id ?? "")
      const where = target ? ` (into ${TAB_LABEL[target.tab]}: ${entryTitle(target)})` : ""
      out.push(`#### Note ${n + 1}${where}`)
      out.push("")
      out.push(c.body.trim() ? c.body : "_Empty note._")
      out.push("")
    })
  }

  return out.join("\n").replace(/\n{3,}$/, "\n\n")
}
