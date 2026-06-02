// My Settings index (Step 4c).
//
// The settings area is a sub-page area with a left-hand domain sub-nav (see
// layout.tsx). The index has no content of its own — it redirects to the first
// domain, Prospects. Server-side redirect so there's no flash of an empty pane.

import { redirect } from "next/navigation"

export default function CoachSettingsIndex() {
  redirect("/dashboard/coach/settings/prospects")
}
