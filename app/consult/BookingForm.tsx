"use client"

// The public consult booking form (prospect workflow, Phase 2). Client facing,
// so it carries the Workforce Ready Now brand: the logo, Peri, the brand blue
// and peach on white, navy for words and the main button.
//
// On success it shows a short "opening the calendar" step that fires the Meta
// pixel Lead (same event id as the server-side Lead, so Meta counts one), then
// opens Calendly with the person's name and email prefilled. This replaces the
// old thank-you page between the form and Calendly.

import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react"
import Image from "next/image"
import { LEAD_SOURCES, LEAD_SOURCE_LABEL, SERVICES, SERVICE_LABEL, takesReferredBy, type Service } from "../../lib/prospects/model"
import { SITUATIONS, SITUATION_LABEL, gradYearOptions, type Situation, type Submitter } from "../../lib/prospects/bookingForm"

const C = {
  navy: "#08203F",
  blue: "#51ADE5",
  peach: "#FEB06A",
  ink: "#1F3550",
  muted: "#5B6B80",
  line: "#D9E4EF",
  wash: "#F4F9FD",
  error: "#C0322F",
}

type Form = {
  submitter: Submitter | ""
  first_name: string; last_name: string; email: string; phone: string
  student_first_name: string; student_last_name: string; student_email: string; student_phone: string
  situation: Situation | ""; situation_other: string
  services: Service[]
  source_category: string; source_detail: string; referred_by_name: string; referred_by_email: string
  school: string; grad_year: string; major: string
  anything_else: string
  website: string // honeypot
}

const EMPTY: Form = {
  submitter: "", first_name: "", last_name: "", email: "", phone: "",
  student_first_name: "", student_last_name: "", student_email: "", student_phone: "",
  situation: "", situation_other: "", services: [],
  source_category: "", source_detail: "", referred_by_name: "", referred_by_email: "",
  school: "", grad_year: "", major: "", anything_else: "", website: "",
}

function cookie(name: string): string {
  if (typeof document === "undefined") return ""
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return m ? decodeURIComponent(m[1]) : ""
}

/** UTMs and click ids from the link they arrived on, plus Meta's cookies. */
function attribution(): Record<string, string> {
  if (typeof window === "undefined") return {}
  const q = new URLSearchParams(window.location.search)
  const fbclid = q.get("fbclid") ?? ""
  return {
    utm_source: q.get("utm_source") ?? "", utm_medium: q.get("utm_medium") ?? "",
    utm_campaign: q.get("utm_campaign") ?? "", utm_content: q.get("utm_content") ?? "",
    utm_term: q.get("utm_term") ?? "", fbclid, gclid: q.get("gclid") ?? "", ttclid: q.get("ttclid") ?? "",
    fbp: cookie("_fbp"),
    fbc: cookie("_fbc") || (fbclid ? `fb.1.${Date.now()}.${fbclid}` : ""),
    landing_page: window.location.href, referrer: document.referrer,
  }
}

/** The body the route expects. Only the fields that apply are sent. */
export function bookingBody(f: Form, elapsedMs: number, attr: Record<string, string>): Record<string, unknown> {
  const parent = f.submitter === "parent"
  return {
    submitter: f.submitter,
    first_name: f.first_name, last_name: f.last_name, email: f.email, phone: f.phone,
    ...(parent ? {
      student_first_name: f.student_first_name, student_last_name: f.student_last_name,
      student_email: f.student_email, student_phone: f.student_phone,
    } : {}),
    situation: f.situation || null,
    situation_other: f.situation === "other" ? f.situation_other : null,
    services: f.services,
    source_category: f.source_category || null,
    source_detail: f.source_category === "other" ? f.source_detail : null,
    ...(takesReferredBy(f.source_category) ? { referred_by_name: f.referred_by_name, referred_by_email: f.referred_by_email } : {}),
    school: f.school, grad_year: f.grad_year || null, major: f.major,
    anything_else: f.anything_else,
    website: f.website,
    elapsed_ms: elapsedMs,
    attribution: attr,
  }
}

const field: CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "12px 14px", fontSize: 16, color: C.ink,
  background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, fontFamily: "inherit", outline: "none",
}

function Label({ htmlFor, children, optional }: { htmlFor: string; children: ReactNode; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} style={{ display: "block", fontSize: 14, fontWeight: 600, color: C.navy, marginBottom: 6 }}>
      {children}{optional && <span style={{ fontWeight: 400, color: C.muted }}> (optional)</span>}
    </label>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset style={{ border: "none", padding: 0, margin: "0 0 28px" }}>
      <legend style={{ fontSize: 18, fontWeight: 700, color: C.navy, padding: 0, marginBottom: hint ? 4 : 14 }}>{title}</legend>
      {hint && <p style={{ margin: "0 0 14px", fontSize: 14, color: C.muted }}>{hint}</p>}
      {children}
    </fieldset>
  )
}

export function BookingForm({ trackLeads = false }: { trackLeads?: boolean }) {
  const [f, setF] = useState<Form>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState<{ redirect: string } | null>(null)
  const startedAt = useRef<number>(0)
  useEffect(() => { startedAt.current = Date.now() }, [])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }))
  const toggleService = (s: Service) =>
    set("services", f.services.includes(s) ? f.services.filter((x) => x !== s) : SERVICES.filter((x) => x === s || f.services.includes(x)))
  const parent = f.submitter === "parent"

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!f.submitter) { setError("Tell us who is filling out this form."); return }
    setSending(true)
    setError(null)
    try {
      const res = await fetch("/api/public/consult-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bookingBody(f, Date.now() - startedAt.current, attribution())),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.ok) {
        setError(j?.error ?? "Something went wrong. Please try again.")
        setSending(false)
        return
      }
      // The browser half of the Lead, with the server's event id so Meta
      // counts the pair once.
      if (trackLeads && j.event_id && typeof window.fbq === "function") {
        window.fbq("track", "Lead", { content_name: "Initial consult booking form" }, { eventID: j.event_id })
      }
      setDone({ redirect: j.redirect })
      window.setTimeout(() => window.location.assign(j.redirect), 1800)
    } catch {
      setError("We couldn't reach the server. Please check your connection and try again.")
      setSending(false)
    }
  }

  return (
    <main style={{ minHeight: "100vh", background: `linear-gradient(180deg, ${C.wash} 0%, #fff 60%)`, color: C.ink, padding: "32px 16px 64px" }}>
      <style>{`
        .wrn-field:focus { border-color: ${C.blue} !important; box-shadow: 0 0 0 3px rgba(81,173,229,0.25); }
        .wrn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .wrn-choice { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; border: 1px solid ${C.line}; border-radius: 10px; cursor: pointer; background: #fff; font-size: 15px; }
        .wrn-choice:has(input:checked) { border-color: ${C.blue}; background: rgba(81,173,229,0.08); }
        .wrn-choice input { margin-top: 3px; accent-color: ${C.navy}; }
        .wrn-submit:hover:not(:disabled) { background: #0E2E57 !important; }
        .wrn-headline { font-size: 46px; }
        @media (max-width: 560px) { .wrn-grid { grid-template-columns: 1fr; } .wrn-headline { font-size: 34px; } }
      `}</style>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        {/* The banner: navy with soft brand glows, the logo, and the headline. */}
        <header
          style={{
            position: "relative", overflow: "hidden", textAlign: "center",
            borderRadius: 20, marginBottom: 24, padding: "36px 24px 40px",
            background: [
              "radial-gradient(circle at 82% 8%, rgba(81,173,229,0.30) 0%, rgba(81,173,229,0) 45%)",
              "radial-gradient(circle at 8% 92%, rgba(254,176,106,0.16) 0%, rgba(254,176,106,0) 40%)",
              `linear-gradient(160deg, #1B3A64 0%, ${C.navy} 70%)`,
            ].join(", "),
            boxShadow: "0 20px 44px rgba(8,32,63,0.22)",
          }}
        >
          <Image src="/logo/WRN_Transparent_Logo.png" alt="Workforce Ready Now" width={104} height={104} priority
            style={{ display: "block", margin: "0 auto 10px" }} />
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 800, letterSpacing: "0.16em", color: C.blue, marginBottom: 14 }}>
            <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: C.blue }} />
            WORKFORCE READY NOW
          </div>
          <h1 className="wrn-headline" style={{ margin: "0 0 14px", color: "#fff", fontWeight: 800, lineHeight: 1.1, letterSpacing: "-0.03em" }}>
            Book your <span style={{ color: C.peach }}>free consult</span>.
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.65, color: "rgba(255,255,255,0.82)", margin: "0 auto", maxWidth: 500 }}>
            Tell us a little about where you, or your student, are right now. We&apos;ll come to the call prepared,
            and you&apos;ll leave with a clear next step.
          </p>
        </header>

        <div style={{ background: "#fff", borderRadius: 18, border: `1px solid ${C.line}`, boxShadow: "0 18px 40px rgba(8,32,63,0.08)", overflow: "hidden" }}>
          <div style={{ height: 5, background: `linear-gradient(90deg, ${C.peach}, ${C.blue})` }} />
          {done ? (
            <div role="status" style={{ padding: "48px 28px", textAlign: "center" }}>
              <div aria-hidden style={{ width: 56, height: 56, borderRadius: 999, margin: "0 auto 16px", background: "rgba(81,173,229,0.15)", color: C.navy, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>✓</div>
              <h2 style={{ fontSize: 24, color: C.navy, margin: "0 0 8px" }}>Thanks, {f.first_name}!</h2>
              <p style={{ fontSize: 16, color: C.muted, margin: "0 0 22px" }}>Opening Peri&apos;s calendar so you can pick a time…</p>
              <a href={done.redirect} style={{ display: "inline-block", padding: "13px 22px", borderRadius: 12, background: C.navy, color: "#fff", fontWeight: 700, textDecoration: "none" }}>
                Open the calendar
              </a>
            </div>
          ) : (
            <form onSubmit={submit} noValidate={false} style={{ padding: "28px 28px 32px" }}>
              {/* Honeypot: hidden from people and screen readers, filled by bots. */}
              <div aria-hidden style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
                <label htmlFor="bf-website">Website</label>
                <input id="bf-website" name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set("website", e.target.value)} />
              </div>

              <Section title="Who's filling out this form?">
                <div role="radiogroup" aria-label="Who's filling out this form?" className="wrn-grid">
                  {([["student", "I'm the student or job seeker"], ["parent", "I'm a parent or guardian"]] as const).map(([v, text]) => (
                    <label key={v} className="wrn-choice">
                      <input type="radio" name="submitter" value={v} checked={f.submitter === v} onChange={() => set("submitter", v)} required />
                      <span>{text}</span>
                    </label>
                  ))}
                </div>
              </Section>

              <Section title={parent ? "Your details" : "About you"}>
                <div className="wrn-grid">
                  <div><Label htmlFor="bf-first">First name</Label><input id="bf-first" className="wrn-field" style={field} required autoComplete="given-name" value={f.first_name} onChange={(e) => set("first_name", e.target.value)} /></div>
                  <div><Label htmlFor="bf-last">Last name</Label><input id="bf-last" className="wrn-field" style={field} required autoComplete="family-name" value={f.last_name} onChange={(e) => set("last_name", e.target.value)} /></div>
                  <div><Label htmlFor="bf-email">Email</Label><input id="bf-email" type="email" className="wrn-field" style={field} required autoComplete="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></div>
                  <div><Label htmlFor="bf-phone">Phone</Label><input id="bf-phone" type="tel" className="wrn-field" style={field} required autoComplete="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></div>
                </div>
              </Section>

              {parent && (
                <Section title="About the student">
                  <div className="wrn-grid">
                    <div><Label htmlFor="bf-s-first">Student&apos;s first name</Label><input id="bf-s-first" className="wrn-field" style={field} required value={f.student_first_name} onChange={(e) => set("student_first_name", e.target.value)} /></div>
                    <div><Label htmlFor="bf-s-last">Student&apos;s last name</Label><input id="bf-s-last" className="wrn-field" style={field} required value={f.student_last_name} onChange={(e) => set("student_last_name", e.target.value)} /></div>
                    <div><Label htmlFor="bf-s-email">Student&apos;s email</Label><input id="bf-s-email" type="email" className="wrn-field" style={field} required value={f.student_email} onChange={(e) => set("student_email", e.target.value)} /></div>
                    <div><Label htmlFor="bf-s-phone" optional>Student&apos;s phone</Label><input id="bf-s-phone" type="tel" className="wrn-field" style={field} value={f.student_phone} onChange={(e) => set("student_phone", e.target.value)} /></div>
                  </div>
                </Section>
              )}

              <Section title={parent ? "The student's current situation" : "Your current situation"}>
                <div role="radiogroup" aria-label="Current situation" style={{ display: "grid", gap: 8 }}>
                  {SITUATIONS.map((s) => (
                    <label key={s} className="wrn-choice">
                      <input type="radio" name="situation" value={s} checked={f.situation === s} onChange={() => set("situation", s)} />
                      <span>{SITUATION_LABEL[s]}</span>
                    </label>
                  ))}
                </div>
                {f.situation === "other" && (
                  <div style={{ marginTop: 10 }}><Label htmlFor="bf-sit-other">Please tell us more</Label><input id="bf-sit-other" className="wrn-field" style={field} required value={f.situation_other} onChange={(e) => set("situation_other", e.target.value)} /></div>
                )}
              </Section>

              <Section title="What would you like help with?" hint="Choose any that apply.">
                <div className="wrn-grid">
                  {SERVICES.map((s) => (
                    <label key={s} className="wrn-choice">
                      <input type="checkbox" checked={f.services.includes(s)} onChange={() => toggleService(s)} />
                      <span>{SERVICE_LABEL[s]}</span>
                    </label>
                  ))}
                </div>
              </Section>

              <Section title="How did you hear about us?">
                <select id="bf-source" aria-label="How did you hear about us?" className="wrn-field" style={field} value={f.source_category} onChange={(e) => set("source_category", e.target.value)}>
                  <option value="">Select…</option>
                  {LEAD_SOURCES.map((s) => <option key={s} value={s}>{LEAD_SOURCE_LABEL[s]}</option>)}
                </select>
                {f.source_category === "other" && (
                  <div style={{ marginTop: 10 }}><Label htmlFor="bf-source-other">Please specify</Label><input id="bf-source-other" className="wrn-field" style={field} required value={f.source_detail} onChange={(e) => set("source_detail", e.target.value)} /></div>
                )}
                {takesReferredBy(f.source_category) && (
                  <div className="wrn-grid" style={{ marginTop: 10 }}>
                    <div><Label htmlFor="bf-ref-name" optional>Who referred you?</Label><input id="bf-ref-name" className="wrn-field" style={field} value={f.referred_by_name} onChange={(e) => set("referred_by_name", e.target.value)} /></div>
                    <div><Label htmlFor="bf-ref-email" optional>Their email</Label><input id="bf-ref-email" type="email" className="wrn-field" style={field} value={f.referred_by_email} onChange={(e) => set("referred_by_email", e.target.value)} /></div>
                  </div>
                )}
              </Section>

              <Section title="For current students and recent graduates (optional)">
                <div className="wrn-grid">
                  <div><Label htmlFor="bf-school">School</Label><input id="bf-school" className="wrn-field" style={field} value={f.school} onChange={(e) => set("school", e.target.value)} /></div>
                  <div>
                    <Label htmlFor="bf-grad">Graduation year</Label>
                    <select id="bf-grad" className="wrn-field" style={field} value={f.grad_year} onChange={(e) => set("grad_year", e.target.value)}>
                      <option value="">Select…</option>
                      {gradYearOptions().map((y) => <option key={y} value={String(y)}>{y}</option>)}
                    </select>
                  </div>
                  <div><Label htmlFor="bf-major">Major</Label><input id="bf-major" className="wrn-field" style={field} value={f.major} onChange={(e) => set("major", e.target.value)} /></div>
                </div>
              </Section>

              <Section title="Anything else?">
                <Label htmlFor="bf-else" optional>Anything else you&apos;d like Peri to know before your call</Label>
                <textarea id="bf-else" className="wrn-field" style={{ ...field, minHeight: 110, resize: "vertical" }} value={f.anything_else} onChange={(e) => set("anything_else", e.target.value)} />
              </Section>

              {error && (
                <div role="alert" style={{ marginBottom: 16, padding: "12px 14px", borderRadius: 10, background: "rgba(192,50,47,0.08)", border: "1px solid rgba(192,50,47,0.3)", color: C.error, fontWeight: 600, fontSize: 15 }}>
                  {error}
                </div>
              )}

              <button type="submit" className="wrn-submit" disabled={sending}
                style={{ width: "100%", padding: "15px 20px", borderRadius: 12, border: "none", background: C.navy, color: "#fff", fontSize: 17, fontWeight: 700, cursor: sending ? "wait" : "pointer", fontFamily: "inherit", opacity: sending ? 0.7 : 1 }}>
                {sending ? "Sending…" : "Continue to pick a time →"}
              </button>
              <p style={{ fontSize: 13, color: C.muted, textAlign: "center", margin: "12px 0 0" }}>
                Next you&apos;ll choose a time on Peri&apos;s calendar.
              </p>
            </form>
          )}
        </div>
        <p style={{ textAlign: "center", fontSize: 13, color: C.muted, marginTop: 24 }}>© Workforce Ready Now</p>
      </div>
    </main>
  )
}
