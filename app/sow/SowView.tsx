"use client"

// A client's SOW as they see it. The coach's Preview renders it now; the
// private link (Step 4) renders the same component, so the preview is the
// page. Workforce Ready Now's light palette, as on the consult booking page.

import Image from "next/image"
import type { SowDocument } from "@/lib/sow/build"
import { money } from "@/lib/sow/build"

const C = {
  navy: "#08203F",
  blue: "#51ADE5",
  peach: "#FEB06A",
  ink: "#1F3550",
  muted: "#5B6B80",
  line: "#D9E4EF",
  wash: "#F4F9FD",
}

export function SowView({ doc, preview = false }: { doc: SowDocument; preview?: boolean }) {
  return (
    <div style={{ background: `linear-gradient(180deg, ${C.wash} 0%, #fff 50%)`, color: C.ink, padding: "24px 16px 40px", fontSize: 15, lineHeight: 1.55 }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <header style={{
          textAlign: "center", borderRadius: 20, padding: "28px 20px 30px", marginBottom: 24,
          background: [
            "radial-gradient(circle at 82% 8%, rgba(81,173,229,0.30) 0%, rgba(81,173,229,0) 45%)",
            "radial-gradient(circle at 8% 92%, rgba(254,176,106,0.16) 0%, rgba(254,176,106,0) 40%)",
            `linear-gradient(160deg, #1B3A64 0%, ${C.navy} 70%)`,
          ].join(", "),
          boxShadow: "0 20px 44px rgba(8,32,63,0.22)",
        }}>
          <Image src="/logo/WRN_Transparent_Logo.png" alt="Workforce Ready Now" width={84} height={84}
            style={{ display: "block", margin: "0 auto 8px" }} />
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.16em", color: C.blue, marginBottom: 10 }}>
            {(doc.practice_name || "Workforce Ready Now").toUpperCase()}
          </div>
          <h1 style={{ margin: 0, color: "#fff", fontSize: 30, fontWeight: 800, letterSpacing: -0.5 }}>Statement of Work</h1>
          <div style={{ color: "rgba(255,255,255,0.85)", marginTop: 8, fontSize: 15 }}>
            {doc.package_name} for {doc.client_name}
          </div>
        </header>

        {doc.opening && (
          <p data-testid="sow-opening" style={{ whiteSpace: "pre-wrap", margin: "0 0 24px" }}>{doc.opening}</p>
        )}

        {doc.stages.map((s) => (
          <section key={s.heading} data-testid="sow-stage" style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: "18px 20px", marginBottom: 16 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 18, color: C.navy, fontWeight: 800 }}>{s.heading}</h2>
            {s.deliverables.map((d) => (
              <div key={d.name} style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 700, color: C.navy }}>{d.name}</div>
                {d.bullets.length > 0 && (
                  <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                    {d.bullets.map((b, i) => <li key={i}>{b}</li>)}
                  </ul>
                )}
              </div>
            ))}
            {s.note && (
              <p style={{ margin: "12px 0 0", padding: "10px 12px", background: C.wash, borderLeft: `3px solid ${C.blue}`, borderRadius: 6, color: C.ink }}>
                {s.note}
              </p>
            )}
          </section>
        ))}

        {doc.sections.map((sec) => (
          <section key={sec.key} data-testid="sow-section" style={{ marginBottom: 16 }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 16, color: C.navy, fontWeight: 800 }}>{sec.label}</h2>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {sec.lines.map((l, i) => <li key={i} style={{ marginBottom: 4 }}>{l}</li>)}
            </ul>
          </section>
        ))}

        <section data-testid="sow-payment" style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: "18px 20px", margin: "24px 0" }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 16, color: C.navy, fontWeight: 800 }}>Investment</h2>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.navy, marginBottom: 8 }}>{money(doc.payment.total_cents)}</div>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {doc.payment.payments.map((p, i) => <li key={i}>{p.label}</li>)}
          </ul>
          {doc.payment.note && <p style={{ margin: "12px 0 0", color: C.ink }}>{doc.payment.note}</p>}
        </section>

        <div style={{ textAlign: "center" }}>
          <button type="button" disabled={preview} style={{
            background: C.navy, color: C.peach, border: "none", borderRadius: 12, padding: "14px 40px",
            fontSize: 17, fontWeight: 800, cursor: preview ? "default" : "pointer", opacity: preview ? 0.6 : 1, fontFamily: "inherit",
          }}>
            Let&apos;s Go
          </button>
          {preview && (
            <p style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>Preview. Let&apos;s Go works on the link you send.</p>
          )}
        </div>
      </div>
    </div>
  )
}
