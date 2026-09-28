"use client"

// Every practice round for one client.
//
// The Required Action raised when homework is completed links here, so a coach
// arriving from an email lands on the list without having to find a tab. The
// list itself now lives in PracticeTab, which is also what the client record's
// Practice tab renders: one implementation, two doors.

import { useParams, useRouter } from "next/navigation"
import { T } from "@/lib/dashboard-theme"
import { TYPE } from "@/lib/theme/surfaces"
import { PracticeTab } from "../PracticeTab"

export default function ClientPracticeListPage() {
  const { clientId } = useParams<{ clientId: string }>()
  const router = useRouter()

  return (
    <div style={{ maxWidth: 820 }}>
      <button type="button" onClick={() => router.push(`/dashboard/coach/clients/${clientId}`)}
        style={{ background: "none", border: "none", color: T.INK_LINK, fontWeight: 700, cursor: "pointer", fontSize: TYPE.secondary, padding: 0, fontFamily: "inherit" }}>
        &larr; Back to the client
      </button>

      <h1 style={{ margin: "10px 0 14px", fontSize: TYPE.title, color: T.TEXT }}>Practice rounds</h1>

      <PracticeTab clientId={clientId} />
    </div>
  )
}
