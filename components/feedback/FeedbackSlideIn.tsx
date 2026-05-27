"use client"

import { useEffect, useState } from "react"
import { T, btnPrimary } from "@/lib/dashboard-theme"
import { SlideInPanel } from "@/components/ui/SlideInPanel"
import { FeedbackForm, type FeedbackFormData } from "@/components/feedback/FeedbackForm"

// Feedback-specific slide-in. Composes the generic SlideInPanel with the form
// and a confirmation state, and owns the submit state machine + POST to the
// Phase 2 endpoint (app/api/feedback). View is 'form' | 'confirmation';
// submitting + submitError flag the in-flight / error sub-states on the form.

type Props = {
  open: boolean
  onClose: () => void
  authToken: string
}

const GENERIC_ERROR =
  "Something went wrong on our end. Please try again or email us directly at support@stopapplyingblind.com."

// Mirror of the server-side strip (app/api/feedback/route.ts): drop any query
// param whose name matches token|auth|key|secret|password|code before the URL
// leaves the browser. Server re-strips as the canonical layer; this is the
// courtesy frontend pass per FRD §9.
const SENSITIVE_PARAM_RE = /token|auth|key|secret|password|code/i
function safePageUrl(): string {
  try {
    const u = new URL(window.location.href)
    const toDelete: string[] = []
    u.searchParams.forEach((_v, k) => {
      if (SENSITIVE_PARAM_RE.test(k)) toDelete.push(k)
    })
    for (const k of toDelete) u.searchParams.delete(k)
    return u.toString()
  } catch {
    return window.location.href
  }
}

export function FeedbackSlideIn({ open, onClose, authToken }: Props) {
  const [view, setView] = useState<"form" | "confirmation">("form")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Reset to a clean form whenever the panel opens fresh, so a prior
  // confirmation / error never bleeds into the next open (matches AddNotePanel).
  useEffect(() => {
    if (open) {
      setView("form")
      setSubmitError(null)
      setSubmitting(false)
    }
  }, [open])

  // Single close path. No-op while a submit is in flight so backdrop click,
  // the × button, and Esc can't dismiss mid-request (matches AddNotePanel's
  // saving guard).
  function handleClose() {
    if (submitting) return
    onClose()
  }

  async function handleSubmit(data: FeedbackFormData) {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          ...data,
          page_url: safePageUrl(),
          user_agent: navigator.userAgent,
        }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        setSubmitError(errData?.message || errData?.error || GENERIC_ERROR)
        setSubmitting(false)
        return
      }
      setView("confirmation")
      setSubmitting(false)
    } catch {
      // Network/transport failure — preserve the form + input, show fallback.
      setSubmitError(GENERIC_ERROR)
      setSubmitting(false)
    }
  }

  return (
    <SlideInPanel open={open} onClose={handleClose} title="Send feedback">
      {view === "form" ? (
        <FeedbackForm
          onSubmit={handleSubmit}
          submitting={submitting}
          error={submitError}
          onCancel={handleClose}
        />
      ) : (
        <div
          style={{
            padding: 24,
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 14,
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 950, color: T.TEXT, letterSpacing: -0.3 }}>
            Thanks — we got it.
          </div>
          <p style={{ fontSize: 14, color: T.MUTED, lineHeight: "22px" }}>
            We&apos;ll reply within 1-2 business days if you asked us to. You can keep working — we&apos;ll find you.
          </p>
          <div>
            <button
              type="button"
              onClick={handleClose}
              style={{ ...btnPrimary, fontSize: 12, padding: "10px 18px" }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </SlideInPanel>
  )
}
