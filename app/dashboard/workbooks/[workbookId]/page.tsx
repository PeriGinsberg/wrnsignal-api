"use client"

// /dashboard/workbooks/[workbookId] — the client's interview workbook.
// Rendered full-bleed (BARE_ROUTES in app/dashboard/layout.tsx): the workbook
// carries its own header and section nav instead of the dashboard shell.

import { useParams } from "next/navigation"
import { ClientWorkbook } from "@/components/workbook/ClientWorkbook"

export default function WorkbookPage() {
  const { workbookId } = useParams<{ workbookId: string }>()
  return <ClientWorkbook workbookId={workbookId} />
}
