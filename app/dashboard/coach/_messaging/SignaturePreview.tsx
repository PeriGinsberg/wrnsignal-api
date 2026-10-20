"use client"

// The signature as it goes out: the coach's text, then the WRN and SIGNAL
// logos (lib/messaging/compose.ts). On white, as in an inbox, because the navy
// logos disappear on a dark panel.

import { TYPE } from "../../../../lib/theme/surfaces"
import { T } from "../../../../lib/dashboard-theme"
import { SIGNATURE_LOGOS } from "../../../../lib/messaging/compose"

export function SignaturePreview({ signature }: { signature: string | null }) {
  const text = (signature ?? "").trim()
  return (
    <div style={{ background: "#fff", border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 8, padding: "12px 14px" }}>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: TYPE.secondary, color: text ? "#222" : "#888" }}>
        {text || "No signature text yet."}
      </pre>
      <div style={{ paddingTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
        {SIGNATURE_LOGOS.map((l) => (
          // eslint-disable-next-line @next/next/no-img-element -- the exact hosted image the email uses
          <img key={l.src} src={l.src} alt={l.alt} width={l.width} style={{ width: l.width, maxWidth: "100%", height: "auto", display: "block" }} />
        ))}
      </div>
    </div>
  )
}
