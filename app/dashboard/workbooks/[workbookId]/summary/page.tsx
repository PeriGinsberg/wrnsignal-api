"use client"

// /dashboard/workbooks/[workbookId]/summary — "Read This 1 Hour Before".
// Phone-first. Built from the client's answers; the checklist ticks persist as
// answers under the reserved summary.check.N keys (never counted as progress).

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { CHECKLIST_PREFIX, type WorkbookContent } from "@/lib/workbook/content"
import { Summary, type InterviewRow } from "@/components/workbook/Summary"
import { WorkbookFrame } from "@/components/workbook/WorkbookFrame"
import { useAutosave } from "@/components/workbook/useAutosave"
import { wbFetch } from "@/components/workbook/api"

type Loaded = {
  workbook: { id: string; content: WorkbookContent; interview: InterviewRow }
  answers: Record<string, { value: unknown; updated_at: string }>
}

export default function SummaryPage() {
  const { workbookId } = useParams<{ workbookId: string }>()
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      const { status, body } = await wbFetch<Loaded>(`/api/me/workbooks/${workbookId}`)
      if (!live) return
      if (status !== 200 || !body.ok) setError(body.error || "Couldn't load your game plan.")
      else setData(body)
    })()
    return () => { live = false }
  }, [workbookId])

  if (error) return <WorkbookFrame><p className="wb-p" style={{ padding: 24 }}>{error}</p></WorkbookFrame>
  if (!data) return <WorkbookFrame><p className="wb-p wb-muted" style={{ padding: 24 }}>Loading your game plan</p></WorkbookFrame>
  return <Loaded data={data} />
}

function Loaded({ data }: { data: Loaded }) {
  const auto = useAutosave(data.workbook.id, data.answers)
  return (
    <WorkbookFrame>
      <Summary
        content={data.workbook.content}
        answers={auto.values}
        interview={data.workbook.interview}
        onCheck={(i, checked) => auto.setNow(`${CHECKLIST_PREFIX}${i}`, checked ? "1" : "")}
      />
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "0 22px 48px" }}>
        <Link href={`/dashboard/workbooks/${data.workbook.id}`} className="wb-btn">Back to my workbook</Link>
      </div>
    </WorkbookFrame>
  )
}
