// framer/AttributionTracker.tsx
//
// Attribution capture — Framer code component drop-in for the live site.
//
// Paste into Framer as a code component and drop once onto the landing
// page. Renders an invisible 0×0 element; on mount it runs the same logic
// as framer/landing_tracking_script.txt (which can no longer be installed
// because Site Settings → Custom Code is not publishing on this account):
//
//   1. Get-or-create jobfit_session_id in localStorage
//   2. Read UTMs + ad-platform click IDs from URL params
//   3. Persist to sessionStorage — UTMs and click IDs as last-touch,
//      landing_page and referrer as first-touch (write-once)
//   4. POST a signal_landing event to /api/track
//   5. Attach a capture-phase click listener for Free Trial CTAs that
//      fires /api/track via sendBeacon so the event survives navigation
//
// All DOM / browser API access is inside useEffect or guarded with
// typeof window checks so Framer's SSR/static-export build never crashes.
// A window-level init flag guarantees at-most-one execution per page
// load, even under React Strict Mode double-invoke.

import * as React from "react"
import { RenderTarget } from "framer"

const API_BASE = "https://wrnsignal-api.vercel.app"
const FREE_TRIAL_DEST = "/signal/job-analysis"
const SESSION_KEY = "jobfit_session_id"

// Window-level flag survives Strict Mode's intentional double-mount in dev
// and prevents duplicate /api/track events if the component remounts.
const INIT_FLAG = "__signalAttributionInit"

export default function AttributionTracker() {
    React.useEffect(() => {
        if (typeof window === "undefined") return
        const w = window as any
        if (w[INIT_FLAG]) return
        w[INIT_FLAG] = true

        // ── Session ID ───────────────────────────────────────────────
        const existingId = localStorage.getItem(SESSION_KEY)
        const sessionId = existingId || crypto.randomUUID()
        if (!existingId) localStorage.setItem(SESSION_KEY, sessionId)

        // ── URL attribution ─────────────────────────────────────────
        const url = new URL(window.location.href)
        const utmSource = url.searchParams.get("utm_source") || ""
        const utmMedium = url.searchParams.get("utm_medium") || ""
        const utmCampaign = url.searchParams.get("utm_campaign") || ""
        const utmContent = url.searchParams.get("utm_content") || ""
        const utmTerm = url.searchParams.get("utm_term") || ""
        const fbclid = url.searchParams.get("fbclid") || ""
        const ttclid = url.searchParams.get("ttclid") || ""
        const gclid = url.searchParams.get("gclid") || ""

        // ── sessionStorage writes ───────────────────────────────────
        // UTMs + click IDs = last-touch (conditional overwrite).
        // landing_page + referrer = first-touch (write-once) so
        // intra-site navigation doesn't clobber the original context.
        try {
            if (utmSource)
                sessionStorage.setItem("signal_utm_source", utmSource)
            if (utmMedium)
                sessionStorage.setItem("signal_utm_medium", utmMedium)
            if (utmCampaign)
                sessionStorage.setItem("signal_utm_campaign", utmCampaign)
            if (utmContent)
                sessionStorage.setItem("signal_utm_content", utmContent)
            if (utmTerm)
                sessionStorage.setItem("signal_utm_term", utmTerm)
            if (fbclid) sessionStorage.setItem("signal_fbclid", fbclid)
            if (ttclid) sessionStorage.setItem("signal_ttclid", ttclid)
            if (gclid) sessionStorage.setItem("signal_gclid", gclid)
            if (!sessionStorage.getItem("signal_landing_page"))
                sessionStorage.setItem(
                    "signal_landing_page",
                    window.location.pathname || ""
                )
            if (!sessionStorage.getItem("signal_referrer"))
                sessionStorage.setItem(
                    "signal_referrer",
                    document.referrer || ""
                )
        } catch {}

        // ── Landing page view event ─────────────────────────────────
        fetch(API_BASE + "/api/track", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                session_id: sessionId,
                page_name: "signal_landing",
                page_path: window.location.pathname,
                referrer: document.referrer || null,
                utm_source: utmSource || null,
                utm_medium: utmMedium || null,
                utm_campaign: utmCampaign || null,
                utm_content: utmContent || null,
                utm_term: utmTerm || null,
            }),
        }).catch(() => {})

        // ── Free Trial CTA click tracking ───────────────────────────
        // Capture phase runs BEFORE any other handler (defends against
        // prior scripts that might intercept the click). sendBeacon
        // survives the navigation away from the page.
        function isFreeTrialCTA(el: EventTarget | null): boolean {
            let node: any = el
            for (let i = 0; node && i < 6; i++) {
                if (node.nodeType === 1) {
                    if (
                        node.getAttribute &&
                        node.getAttribute("data-cta") === "free-trial"
                    ) {
                        return true
                    }
                    if (node.tagName === "A" && node.href) {
                        if (
                            String(node.href).indexOf(FREE_TRIAL_DEST) !== -1
                        )
                            return true
                    }
                }
                node = node.parentNode
            }
            return false
        }

        function fireFreeTrialCtaClick() {
            const payload = JSON.stringify({
                session_id: sessionId,
                page_name: "free_trial_cta_click",
                page_path: window.location.pathname,
                referrer: document.referrer || null,
                utm_source:
                    sessionStorage.getItem("signal_utm_source") || null,
                utm_medium:
                    sessionStorage.getItem("signal_utm_medium") || null,
                utm_campaign:
                    sessionStorage.getItem("signal_utm_campaign") || null,
            })
            try {
                if (
                    typeof navigator !== "undefined" &&
                    navigator.sendBeacon
                ) {
                    const blob = new Blob([payload], {
                        type: "application/json",
                    })
                    navigator.sendBeacon(API_BASE + "/api/track", blob)
                } else {
                    fetch(API_BASE + "/api/track", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: payload,
                        keepalive: true,
                    }).catch(() => {})
                }
            } catch {}
        }

        const clickHandler = (e: MouseEvent) => {
            if (isFreeTrialCTA(e.target)) fireFreeTrialCtaClick()
        }
        document.addEventListener("click", clickHandler, true) // capture

        // No cleanup: the listener is intentional for the page's lifetime
        // and INIT_FLAG guarantees we never register it twice.
    }, [])

    // Render modes:
    //   - Framer canvas (editor): a small labeled pill so the component
    //     is discoverable on the canvas and in the layers panel. Prevents
    //     future "is the tracker still placed on this page?" confusion.
    //   - Preview / published / live site: zero-size, absolutely positioned,
    //     invisible. Doesn't shift layout, doesn't intercept clicks, not
    //     read by screen readers.
    const inCanvas =
        typeof RenderTarget !== "undefined" &&
        RenderTarget.current() === RenderTarget.canvas

    if (inCanvas) {
        return (
            <div
                style={{
                    width: 160,
                    height: 26,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    padding: "0 10px",
                    background: "#1a1a1a",
                    border: "1px solid #3a3a3a",
                    borderRadius: 6,
                    color: "#aaa",
                    fontSize: 10,
                    fontWeight: 600,
                    fontFamily: "monospace",
                    letterSpacing: 0.3,
                    pointerEvents: "none",
                    whiteSpace: "nowrap",
                }}
            >
                📊 Attribution Tracker
            </div>
        )
    }

    return (
        <div
            aria-hidden="true"
            style={{
                width: 0,
                height: 0,
                overflow: "hidden",
                position: "absolute",
                pointerEvents: "none",
            }}
        />
    )
}
