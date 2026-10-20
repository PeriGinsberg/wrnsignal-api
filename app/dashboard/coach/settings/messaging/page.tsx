// Messaging settings domain: the address a coach's messages come from (shown,
// set by Peri) and their signature (edited here). See
// app/api/coach/messaging-settings/route.ts.

import { T } from "../../../../../lib/dashboard-theme"
import { SettingsBlock } from "../SettingsBlock"
import { MessagingSettings } from "./MessagingSettings"

export default function MessagingSettingsPage() {
  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3, color: T.TEXT, margin: 0 }}>
          Messaging
        </h2>
        <p style={{ fontSize: 13, color: T.MUTED, marginTop: 6 }}>
          How the emails you write from a client&apos;s record go out.
        </p>
      </div>
      <SettingsBlock title="Email">
        <MessagingSettings />
      </SettingsBlock>
    </div>
  )
}
