"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { getSupabaseBrowser } from "../../lib/supabase-browser"
import { T, eyebrow } from "../../lib/dashboard-theme"
import { action, LIGHT } from "../../lib/theme/surfaces"
import { FRAMER_URL } from "../../lib/urls"
import { signOutCompletely } from "../../lib/signOut"
// The return path back to the Framer job workspace. Already the tracker's
// "see the analysis" jump; the layout is now its third consumer, so lib/ is
// where it belongs the next time it is touched.
import { openInSignal } from "./tracker/openInSignal"
import { FeedbackSlideIn } from "../../components/feedback/FeedbackSlideIn"
import {
  HomeIcon, TrackIcon, NetworkIcon, ProfileIcon, CoachesHubIcon,
  SignOutIcon, ScoreAJobIcon, CompaniesIcon,
} from "../../components/icons"

// Sprint 3 (2026-05-08): conditional nav rendering by is_coach.
//   • D2C: My Account (renamed from Overview), Job Tracker
//   • Coach: Coaches Center group (Dashboard / Required Actions / My
//     Clients), then My Account, then Back to SIGNAL. Job Tracker
//     hidden from coach nav.
// (Resume Rx was a third D2C item here; the feature was removed 2026-08-27.)
//
// Redesign step 2 (2026-08-03): the D2C shell moves to the light theme. The
// nav stays NAVY because navy is structure in the new language; what changes
// is the ground the pages sit on and the nav's own active treatment. Peach is
// gone from the nav entirely: it is the action colour and a nav item is a
// place, not an action. See COLOR-SYSTEM.md section 6.9.
//
// Coach routes are deliberately NOT converted. They keep the dark shell until
// the Coaches Center pass in stage 2, so this change cannot break a surface it
// was not designed for. `isD2C` and `useLight` below are the only switches.

type NavItem = {
  // Optional: action items (e.g. Feedback) render as a <button> with no href.
  href?: string
  label: string
  external?: boolean
  /** When true, also marks active for descendants (e.g. /clients/[id]) */
  matchPrefix?: boolean
  /** Action items render as a <button> instead of an <a>; no navigation. */
  action?: "feedback" | "logout"
  /** Disabled "Soon" item — greyed, non-clickable, no navigation. */
  disabled?: boolean
  /** Opens in a new browser tab via a plain anchor (target="_blank").
   *  For static/external resources like the Coaches Guide PDF. */
  newTab?: boolean
  /**
   * Sub-nav, revealed only while the parent is the active section. Networking
   * is the one section whose views are real routes, so it is the one that
   * nests. Job Tracker's Applications / Interviews / History are an in-page
   * tab strip, per the mockups, so it stays a single entry.
   */
  children?: NavItem[]
  /** The family mark for this destination. Top-level D2C items only: the coach
   *  nav is unconverted, and sub-nav items sit indented under a marked parent. */
  icon?: React.ReactNode
}
type NavGroup = { header: string; items: NavItem[] }

const D2C_NAV: NavGroup[] = [
  {
    header: "MY ACCOUNT",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: <HomeIcon size={20} /> },
      // matchPrefix so a future application detail page keeps the section lit.
      { href: "/dashboard/tracker", label: "Job Tracker", matchPrefix: true, icon: <TrackIcon size={20} /> },
      {
        href: "/dashboard/network",
        label: "Networking",
        matchPrefix: true,
        icon: <NetworkIcon size={20} />,
        // NO CHILDREN. Companies and Contacts were two tabs over one dataset
        // and they are one page now; a sub-nav with a single entry pointing at
        // its own parent is furniture. Templates and the networking profile
        // went with the retirement, and Summary was dropped in favour of the
        // Dashboard being the single "what needs you" surface.
      },
      { href: "/dashboard/profile", label: "My Profile", matchPrefix: true, icon: <ProfileIcon size={20} /> },
      // The temporary "Log out" entry is GONE (step 8). Signing out is now
      // My Profile > Account, which is where it was always designed to live.
      // The coach nav keeps its own Log out: coaches have no My Profile.
    ],
  },
]

const COACH_NAV: NavGroup[] = [
  {
    header: "COACHES CENTER",
    items: [
      { href: "/dashboard/coach", label: "Dashboard" },
      // matchPrefix so /dashboard/coach/clients/[id] highlights "My Clients"
      { href: "/dashboard/coach/clients", label: "My Clients", matchPrefix: true },
      // matchPrefix so /dashboard/coach/prospects/[id] highlights "My Prospects"
      { href: "/dashboard/coach/prospects", label: "My Prospects", matchPrefix: true },
      { href: "/dashboard/coach/required-actions", label: "Required Actions" },
    ],
  },
  {
    header: "MY SETTINGS",
    items: [
      // Domain items are real routes (deep-linkable). matchPrefix keeps the
      // group highlighted on any /settings/<domain> descendant. Billing is a
      // disabled "Soon" domain (no route this phase). Spec §4 Move 1 / §7.
      { href: "/dashboard/coach/settings/prospects", label: "Prospects", matchPrefix: true },
      { href: "/dashboard/coach/settings/services", label: "Services", matchPrefix: true },
      { href: "/dashboard/coach/settings/documents", label: "Documents", matchPrefix: true },
      { label: "Billing", disabled: true },
    ],
  },
  {
    header: "SUPPORT",
    items: [
      // Static resource — the coach guide PDF in /public. Opens in a new tab
      // (newTab) rather than client-side navigation; never marked active.
      { href: "/SIGNAL-Coach-Guide.pdf", label: "Coaches Guide", newTab: true },
      // Action item: opens the beta-feedback slide-in (Phase 4). Renders as a
      // <button>, not an <a> — no navigation.
      { label: "Feedback", action: "feedback" },
    ],
  },
  {
    header: "ACCOUNT",
    items: [
      // Coaches operate only as coaches. The D2C "My Account" + external "Back
      // to SIGNAL" links are removed from the coach nav; coach configuration
      // now lives in the My Settings group above. (Spec §0.2.)
      // Sign out. Renders as a <button> (action item); full session teardown
      // in handleLogout below. Coaches otherwise have no way to log out.
      { label: "Log out", action: "logout" },
    ],
  },
]

/**
 * Routes whose screens have been redesigned into the light theme. Only these
 * get the light ground; everything else keeps the dark shell so an unconverted
 * page never renders dark cards on a pale background.
 *
 * Grows one entry per screen as the redesign lands.
 *
 * Matching is EXACT by default. A trailing "/*" opts a route into covering its
 * descendants. This started as exact-or-descendant and that was wrong: adding
 * the contacts LIST silently lit up the contact RECORD underneath it, which is
 * a different screen with its own components, so an unconverted page went onto
 * the light ground exactly as this list exists to prevent. A screen now has to
 * ask for its children.
 */
const LIGHT_ROUTES: string[] = [
  // Step 3 the list, step 4 the record. The "/*" covers both: the only
  // descendant of this route is the contact record itself.
  "/dashboard/network/contacts/*",  // the contact record, and the legacy
                                    // roster URL that now redirects.
  "/dashboard/network",             // the merged roster. EXACT: nothing
                                    // below it is converted by implication.
  "/dashboard/network/companies",   // the retired board, now a redirect to
                                    // the roster. Listed so the hop does not
                                    // flash the dark shell on the way.
  "/dashboard/tracker/*",           // step 7, all three views plus the
                                    // application detail page.
  "/dashboard/profile",             // step 8, the sectioned settings home.
  "/dashboard",                     // step 6, the stateful home. EXACT: every
                                    // converted descendant is listed by name.
]

function isLightRoute(pathname: string): boolean {
  return LIGHT_ROUTES.some((r) =>
    r.endsWith("/*")
      ? pathname === r.slice(0, -2) || pathname.startsWith(r.slice(0, -1))
      : pathname === r,
  )
}

/**
 * The WORK ON A JOB zone, as one entry rather than three.
 *
 * The design calls for JobFit, Positioning and Cover Letter as separate nav
 * items, but Framer serves all three as tabs inside a single /signal/jobfit
 * page. Three items pointing at one URL would promise three places and deliver
 * one. So this is the hub, named for what it is. It splits into three when the
 * Phase C Framer reskin gives those tabs real routes.
 */
const EXTERNAL_NAV_ITEM: NavItem = {
  href: `${FRAMER_URL}/signal/jobfit`,
  label: "Work on a job →",
  external: true,
}

function isItemActive(item: NavItem, pathname: string): boolean {
  if (!item.href) return false
  if (pathname === item.href) return true
  if (item.matchPrefix && pathname.startsWith(item.href + "/")) return true
  return false
}

function isGroupActive(group: NavGroup, pathname: string): boolean {
  return group.items.some((it) => isItemActive(it, pathname))
}

function Logo() {
  return (
    <div style={{ padding: "28px 20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <span style={{ fontSize: 26, fontWeight: 950, fontStyle: "italic", letterSpacing: -0.5, color: "#ffffff" }}>
          SIGNAL
        </span>
        <div style={{ width: 16, height: 4, background: T.WRN_ORANGE, borderRadius: 1, marginLeft: 4 }} />
      </div>
      <div style={{ marginTop: 4, display: "flex", gap: 3, alignItems: "center" }}>
        <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: 0.8, color: T.DIM, textTransform: "uppercase" }}>by</span>
        <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: 0.8, color: T.WRN_ORANGE, textTransform: "uppercase" }}>WORKFORCE</span>
        <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: 0.8, color: T.WRN_BLUE, textTransform: "uppercase" }}>READY NOW</span>
      </div>
    </div>
  )
}

/**
 * Shown when a Framer handoff arrived without a refresh token, so this tab is
 * running on the raw bearer and will stop working when that token expires.
 *
 * THIS IS THE "FAIL VISIBLY" HALF OF THE FIX. The alternative that used to be
 * here was to fake a session by putting the access token in the refresh_token
 * field, which hid the problem until the auto-refresh 400 signed the user out
 * with no explanation. A session that will end is worth saying out loud; a
 * session that lies about being renewable is not.
 *
 * Not a blocking screen: bearer-only genuinely works, every page reads the
 * handoff token, and kicking a working session to a login wall would be a
 * regression for anyone still on the old Framer bundle.
 */
function HandoffDegradedBanner() {
  return (
    <div
      style={{
        width: "100%",
        // The third stranded dark-theme token found in this shell, and the
        // same shape as the other two: T.TEXT is rgba(255,255,255,0.92), which
        // measured 1.11:1 on this pale wash. The warning was rendering and
        // could not be read, which is the worst possible failure for the one
        // banner whose whole job is to warn.
        //
        // ATTENTION, NOT ERROR, and the distinction is load-bearing. Nothing
        // has failed here: the session works and will keep working until the
        // token expires, and there is something to do about it. The hardcoded
        // rgba(196,53,27,...) was error red in all but name, so this both
        // fixes the contrast and corrects what the strip was claiming.
        // COLOR-SYSTEM 6.11 is explicit that "needs you" and "destructive"
        // must never read alike.
        //
        // fill carries its own ink by design; the pairing measures 5.98:1.
        // The accent takes the bottom edge, which is what keeps this reading
        // as a warning strip rather than the neutral shelf above it.
        background: LIGHT.meaning.attention.fill,
        borderBottom: `1px solid ${LIGHT.meaning.attention.accent}`,
        padding: "10px 20px",
        fontSize: 13,
        lineHeight: "18px",
        color: LIGHT.meaning.attention.ink,
        flexShrink: 0,
      }}
    >
      <strong style={{ fontWeight: 900 }}>Limited session.</strong>{" "}
      You arrived from SIGNAL without a renewable session, so this tab will sign
      out when the current token expires. Sign in here directly to keep working
      past that.
    </div>
  )
}

/**
 * The strip a coach gets while looking at a client's networking board.
 *
 * It does two jobs, and the second is the one that matters. It says WHOSE board
 * this is, because the page below is the client's own screen rendered exactly
 * as the client sees it, and a coach who forgets that will read their own
 * follow-ups off it. And it gives the way back to the client, which the coach
 * nav does not: COACH_NAV lists places, not the client you were just inside.
 */
function CoachBoardBar({ clientId, clientName }: { clientId: string; clientName: string | null }) {
  return (
    <div
      style={{
        width: "100%",
        minHeight: 40,
        background: LIGHT.well,
        borderBottom: `1px solid ${LIGHT.border}`,
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "8px 20px",
        flexShrink: 0,
      }}
    >
      <a
        href={`/dashboard/coach/clients/${clientId}`}
        style={{
          color: LIGHT.text.primary,
          fontSize: 13,
          fontWeight: 800,
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        {"←"} Back to {clientName || "the client"}
      </a>
      <span style={{ color: LIGHT.text.muted, fontSize: 12.5 }}>
        {/* Present tense and second person, because the risk is a coach acting
            on this board as if it were their own. Naming the client is the
            correction; naming the permission would not be. */}
        You are viewing {clientName ? `${clientName}'s` : "this client's"} networking board.
        Anything you add here is recorded as yours.
      </span>
    </div>
  )
}

function FramerBanner({ runId, jobTitle }: { runId: string | null; jobTitle: string | null }) {
  return (
    <div
      style={{
        width: "100%",
        height: 40,
        // NEUTRAL, not peach. This was a 10% orange wash with a 20% orange
        // edge, which is orange doing a job it does not have: it is for rules,
        // section numbers, eyebrow labels and bullets, never a background fill.
        //
        // `well` is the system's recessed surface, so the strip reads as a
        // shelf above the app rather than as a card floating on the ground,
        // and it stays distinct from the white cards below it. The navy pill
        // measures 15.26:1 on it.
        background: LIGHT.well,
        borderBottom: `1px solid ${LIGHT.border}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        flexShrink: 0,
      }}
    >
      {/* THIS BUTTON USED TO BE BROKEN, in a way that looked like it worked.
          It called window.close() and fell back to history.back(). Neither can
          return you to the job: window.close() only closes script-opened
          windows and this is a same-tab navigation, and openDashboard leaves
          via location.replace(), which REPLACES the Framer history entry
          instead of pushing one. So Back went to whatever preceded the job
          workspace, usually the auth page or a blank tab.

          openInSignal carries the session in a fragment and appends ?run=,
          which the Framer bundle already reads on arrival, so the student
          lands on the rendered result rather than the paste screen.

          Rendered ONLY with a run id. Without one there is no job to go back
          to, and a button that cannot keep its promise is worse than no
          button. The empty span holds the space-between layout. */}
      {runId ? (
        <button
          onClick={() => void openInSignal(runId)}
          style={{
            // FILLED, from the system's one action shape rather than a
            // hand-rolled pill: solid navy #08203F with white ink, which the
            // token file measures at 16.30:1, the highest-contrast pairing in
            // either theme.
            //
            // It was T.WRN_ORANGE as bare text, which broke the brand rule and
            // then failed at the job anyway. Orange is for rules, section
            // numbers, eyebrow labels and bullets, never body or control type;
            // peach measures 1.81 as text on white, so it was both off-palette
            // and close to unreadable. Bare coloured text also reads as a
            // label, and this is the only way back to the job.
            //
            // CANNOT BE CONFUSED WITH THE NAV'S ACTIVE ITEM, which is a
            // translucent white pill on navy. This is that exact inverse, and
            // it sits in the strip above the nav rather than inside it.
            //
            // No second accent colour. The fill already carries it, and a blue
            // border on navy would be a new hex this palette does not have.
            ...action(LIGHT, "primary"),
            borderRadius: 999,
            padding: "6px 14px",
            fontSize: 12.5,
            lineHeight: "16px",
            // A posting title arrives capped at 80 chars, which still overruns
            // a 40px strip. Truncate rather than let the row grow.
            maxWidth: 340,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          &larr; Back to {jobTitle || "your job"}
        </button>
      ) : (
        <span />
      )}
      {/* T.MUTED was a DARK-theme token, rgba(255,255,255,0.6), left behind
          when the shell went light. White at 60% on a near-white strip
          measured 1.03:1, which is not low contrast so much as no contrast:
          the sentence was rendering and could not be read.

          LIGHT.text.muted is the light theme's quiet ink, 5.10:1 here. Muted
          rather than secondary on purpose, because this line is ambient
          context and should sit below the control beside it. */}
      <span style={{ fontSize: 12, color: LIGHT.text.muted }}>
        You&apos;re in your SIGNAL Dashboard
      </span>
    </div>
  )
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "authed" | "unauthed">("loading")
  const [email, setEmail] = useState("")
  const [linkSent, setLinkSent] = useState(false)
  const [error, setError] = useState("")
  const [sending, setSending] = useState(false)
  const [fromFramer, setFromFramer] = useState(false)
  // The job this dashboard visit came from, for the "Back to <title>"
  // control. Null on a page opened directly, which is the case that
  // hides the button.
  const [returnRun, setReturnRun] = useState<string | null>(null)
  const [returnTitle, setReturnTitle] = useState<string | null>(null)
  // Arrived from Framer with an access token but no refresh token, so this tab
  // is running on the raw bearer with no way to renew it. See the handoff block
  // below for why that is now a visible state instead of a silent one.
  const [handoffDegraded, setHandoffDegraded] = useState(false)
  const [isCoach, setIsCoach] = useState(false)
  // The client whose board a coach is currently looking at, read off the URL
  // rather than threaded down, for the same reason authFetch reads it: the
  // networking pages already treat the query string as their state.
  const [boardClientId, setBoardClientId] = useState<string | null>(null)
  const [boardClientName, setBoardClientName] = useState<string | null>(null)
  // True when this D2C account has an ACTIVE coach (from /api/profile's `coached`
  // gate). Gates the coached-only "Coaching Tools" nav item.
  const [coached, setCoached] = useState(false)
  // Beta-feedback slide-in (Phase 3). Mounted at layout level so it's
  // reachable from any coach page; nav trigger wired in Phase 4.
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [authToken, setAuthToken] = useState<string | null>(null)
  // Dev-only password sign-in. Gated on NEXT_PUBLIC_DEV_AUTH=true (set in
  // .env.development.local; absent in prod .env.local). Without that env
  // var, the password field doesn't render and this state is unused.
  const [password, setPassword] = useState("")
  const [passwordSubmitting, setPasswordSubmitting] = useState(false)
  const showDevAuth = process.env.NEXT_PUBLIC_DEV_AUTH === "true"
  const pathname = usePathname()

  // The job to come back to.
  //
  // DECLARED BEFORE THE AUTH EFFECT DELIBERATELY. React fires mount effects in
  // declaration order, and the auth effect below strips the fragment with
  // history.replaceState. Read it here or it is already gone.
  //
  // Two sources, in priority order. The fragment is the arrival from Framer.
  // sessionStorage is every dashboard page after that, which is what lets
  // Job Details -> tracker list -> a company page still offer the way back.
  // Same storage the handoff token uses: per-tab, dies with the tab, and
  // cleared by signOutCompletely so a second account never inherits it.
  useEffect(() => {
    if (typeof window === "undefined") return
    const hash = new URLSearchParams(
      (window.location.hash || "").replace(/^#/, "")
    )
    const fromHash = hash.get("from_run")
    if (fromHash) {
      const title = hash.get("from_title") || ""
      sessionStorage.setItem("signal_return_run", fromHash)
      if (title) sessionStorage.setItem("signal_return_title", title)
      else sessionStorage.removeItem("signal_return_title")
      setReturnRun(fromHash)
      setReturnTitle(title || null)
      setFromFramer(true)
      return
    }
    const stored = sessionStorage.getItem("signal_return_run")
    if (stored) {
      setReturnRun(stored)
      setReturnTitle(sessionStorage.getItem("signal_return_title"))
    }
    // The banner's own flag, restored for the same reason: it was set only on
    // the arrival page, so the banner vanished on the first click inside the
    // dashboard and took the return control with it.
    if (sessionStorage.getItem("signal_from_framer") === "1") setFromFramer(true)
  }, [])

  // Reads location directly rather than useSearchParams(), which would force a
  // Suspense boundary around the whole dashboard shell. Re-runs on pathname so
  // leaving the networking tree clears the bar rather than stranding it.
  useEffect(() => {
    if (typeof window === "undefined") return
    const onBoard = window.location.pathname.startsWith("/dashboard/network")
    const id = onBoard ? new URLSearchParams(window.location.search).get("client_profile_id") : null
    setBoardClientId(id)
    if (!id || !isCoach) { setBoardClientName(null); return }

    // The name is FETCHED, not passed in the URL. A name in the query string is
    // text the page would render on someone else's say-so, and the coach client
    // route already owns the answer and the access check for it.
    let live = true
    ;(async () => {
      try {
        const { data } = await getSupabaseBrowser().auth.getSession()
        const token = data.session?.access_token || sessionStorage.getItem("signal_handoff_token")
        const res = await fetch(`/api/coach/clients/${id}/profile`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const j = await res.json().catch(() => null)
        if (live && res.ok && j?.ok) setBoardClientName(j.profile?.name || j.profile?.email || null)
      } catch {
        // The bar still says "Back to the client" and still links correctly.
        // A missing name is a worse bar, not a broken one.
      }
    })()
    return () => { live = false }
  }, [pathname, isCoach])

  useEffect(() => {
    const supabase = getSupabaseBrowser()

    async function init() {
      const url = new URL(window.location.href)

      // Handle Supabase magic-link PKCE code exchange. This MUST happen
      // before getSession() or the session will not initialize.
      const code = url.searchParams.get("code")
      if (code) {
        const { error: codeErr } = await supabase.auth.exchangeCodeForSession(code)
        if (codeErr) {
          console.warn("[dashboard] code exchange failed:", codeErr.message)
        }
        url.searchParams.delete("code")
        window.history.replaceState({}, "", url.pathname + url.search + url.hash)
        const { data } = await supabase.auth.getSession()
        setStatus(data.session ? "authed" : "unauthed")
        return
      }

      // ── Token handoff from Framer ────────────────────────────────────────
      //
      // TWO SOURCES, IN PRIORITY ORDER. The fragment is where the current
      // Framer bundle puts both tokens, matching the direction that already
      // worked (openInSignal and the Back to SIGNAL link both hand off in a
      // fragment). The `?token=` query param is the legacy sender, kept only
      // until the prod Framer bundle carries the fragment form; a query string
      // reaches the server and lands in access logs, a fragment never does.
      const hashParams = new URLSearchParams(
        (window.location.hash || "").replace(/^#/, "")
      )
      const handoffAccess =
        hashParams.get("access_token") || url.searchParams.get("token")
      const handoffRefresh = hashParams.get("refresh_token")

      if (handoffAccess) {
        // Flag as coming from Framer
        sessionStorage.setItem("signal_from_framer", "1")
        sessionStorage.setItem("signal_handoff_token", handoffAccess)
        setFromFramer(true)

        // Strip the credentials from the URL before doing anything with them.
        // `url.pathname + url.search` deliberately DROPS the fragment, which is
        // where the tokens now live; the old form appended url.hash back on,
        // which would have left a refresh token sitting in the address bar.
        url.searchParams.delete("token")
        window.history.replaceState({}, "", url.pathname + url.search)

        if (handoffRefresh) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: handoffAccess,
            refresh_token: handoffRefresh,
          })
          if (!sessionError) {
            setStatus("authed")
            return
          }
          // A real pair that the auth server rejected. Nothing was persisted,
          // so fall through to bearer-only rather than leaving a half-session.
          console.error(
            `AUTH_HANDOFF_FAILED reason=${sessionError.message}`,
          )
          setHandoffDegraded(true)
          setStatus("authed")
          return
        }

        // NO REFRESH TOKEN, SO NO SESSION. This is where the sign-out bug came
        // from: the old code called setSession({ access_token: t,
        // refresh_token: t }), passing the ACCESS token as the refresh token.
        // setSession makes no network call while the access token is still
        // valid, so that succeeded silently and persisted a session whose
        // refresh_token could never work. The first auto-refresh then POSTed an
        // access token to grant_type=refresh_token, got a 400, and signed the
        // user out of a tab they had not touched.
        //
        // A fake refresh token is never better than no session. The dashboard
        // does not need one: getToken() across ~28 call sites already falls
        // back to signal_handoff_token, so bearer-only is a real supported mode
        // and every page keeps working. What it cannot do is outlive the access
        // token, which is why this is now surfaced rather than warned about.
        console.error(
          "AUTH_HANDOFF_DEGRADED reason=no_refresh_token " +
            "detail=sender_passed_access_token_only_bearer_mode_until_expiry",
        )
        setHandoffDegraded(true)
        setStatus("authed")
        return
      }

      // Check for existing Framer flag
      if (sessionStorage.getItem("signal_from_framer") === "1") {
        setFromFramer(true)
      }

      // Also detect Framer referrer
      if (document.referrer.includes("framer.app")) {
        sessionStorage.setItem("signal_from_framer", "1")
        setFromFramer(true)
      }

      // Normal session check
      const { data } = await supabase.auth.getSession()
      setStatus(data.session ? "authed" : "unauthed")
    }

    init()

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        setStatus("authed")
      } else if (event === "SIGNED_OUT") {
        setStatus("unauthed")
      }
      // Ignore transient refresh failures — Supabase auto-retries
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  // Check coach status once authed
  useEffect(() => {
    if (status !== "authed") return
    async function checkCoach() {
      try {
        const supabase = getSupabaseBrowser()
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token || sessionStorage.getItem("signal_handoff_token")
        if (!token) return
        setAuthToken(token)
        const res = await fetch("/api/profile", { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) return
        const j = await res.json()
        setIsCoach(!!j.profile?.is_coach)
        setCoached(!!j.profile?.coached)
      } catch {}
    }
    checkCoach()
  }, [status])

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) return
    setSending(true)
    setError("")
    try {
      const res = await fetch("/api/auth/send-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.message || data.error || "Failed to send link.")
      } else {
        setLinkSent(true)
      }
    } catch {
      setError("Network error — please try again.")
    }
    setSending(false)
  }

  // Dev-only password sign-in. Mirrors the server-side redirect logic in
  // /api/auth/send-link so coaches land on /dashboard/coach regardless of
  // profile_complete. Hidden behind NEXT_PUBLIC_DEV_AUTH=true.
  async function signInWithPassword() {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !password) {
      setError("Email and password are required.")
      return
    }
    setPasswordSubmitting(true)
    setError("")
    try {
      const supabase = getSupabaseBrowser()
      const { data, error: authErr } = await supabase.auth.signInWithPassword({
        email: trimmed,
        password,
      })
      if (authErr || !data.session) {
        setError(authErr?.message || "Sign-in failed.")
        return
      }
      const token = data.session.access_token
      // Determine redirect using same logic as the server-side magic-link
      // sender (is_coach checked BEFORE profile_complete).
      let target = "/dashboard"
      try {
        const profRes = await fetch("/api/profile", {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (profRes.ok) {
          const { profile } = await profRes.json()
          if (profile?.is_coach) target = "/dashboard/coach"
          else if (profile?.profile_complete) target = "/dashboard/tracker"
        }
      } catch {
        // Profile lookup failed — fall through to /dashboard
      }
      window.location.replace(target)
    } catch (e: any) {
      setError(e?.message || "Sign-in failed.")
    } finally {
      setPasswordSubmitting(false)
    }
  }

  // Full sign-out teardown. The session lives in two places (no @supabase/ssr):
  //   1. Supabase session in localStorage (sb-<ref>-auth-token) — cleared by
  //      auth.signOut().
  //   2. signal_handoff_token in sessionStorage — the Framer-handoff fallback
  //      bearer (used by getToken across pages and the coach check above).
  // Both must be cleared or the next load auto-restores the session. We also
  // drop the signal_from_framer UI flag so the login screen is clean. A full
  // navigation (window.location) — not router.push — guarantees the layout
  // re-initializes from scratch in the unauthenticated state.
  // The coach nav's Log out. The student's lives on My Profile > Account, and
  // both call the SAME teardown: lib/signOut.ts, which carries the fix for the
  // global-signOut-throws-before-clearing-storage bug. Two copies of that would
  // drift, and the redirect makes the failure look like success.
  async function handleLogout() {
    await signOutCompletely()
  }

  // The entry screens are light. They are the first thing a student sees, and a
  // dark sign-in leading into a light app undercuts the whole first impression.
  // Deliberately a SMALL pass: the ground, the card, the input well and the one
  // peach action. Not the full treatment, which arrives with the real screens.
  // A coach signing in sees this too, then lands on the dark coach shell. That
  // is a brief mismatch for one person and is accepted rather than designed for.
  const authInput: React.CSSProperties = {
    width: "100%",
    background: LIGHT.well,
    border: `1px solid ${LIGHT.border}`,
    borderRadius: 10,
    padding: "12px 14px",
    fontSize: 14,
    color: LIGHT.text.primary,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
  }
  const authLabel: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: LIGHT.text.muted,
  }
  const authCard: React.CSSProperties = {
    background: LIGHT.card,
    border: `1px solid ${LIGHT.borderSoft}`,
    borderRadius: 16,
    boxShadow: LIGHT.shadow.raised,
    padding: 28,
    marginTop: 24,
  }
  const authWordmark = (
    <div style={{ textAlign: "center", marginBottom: 8 }}>
      <span style={{ fontSize: 26, fontWeight: 950, fontStyle: "italic", letterSpacing: -0.5, color: LIGHT.text.primary }}>
        SIGNAL
      </span>
      <div style={{ width: 16, height: 4, background: T.WRN_ORANGE, borderRadius: 1, margin: "6px auto 0" }} />
    </div>
  )

  if (status === "loading") {
    return (
      <div style={{ minHeight: "100vh", background: LIGHT.page, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: LIGHT.text.muted, fontSize: 13 }}>Loading...</span>
      </div>
    )
  }

  if (status === "unauthed") {
    return (
      <div style={{ minHeight: "100vh", background: LIGHT.page, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 360 }}>
          {authWordmark}

          {linkSent ? (
            <div style={{ ...authCard, textAlign: "center" }}>
              <div style={{ ...authLabel, color: LIGHT.meaning.replied.ink }}>LINK SENT</div>
              <p style={{ fontSize: 15, color: LIGHT.text.primary, marginTop: 12, fontWeight: 800, letterSpacing: -0.2 }}>
                Check your email
              </p>
              <p style={{ fontSize: 13, color: LIGHT.text.muted, marginTop: 8, lineHeight: "20px" }}>
                We sent a sign-in link to{" "}
                <span style={{ color: LIGHT.meaning.progress.ink, fontWeight: 700 }}>{email}</span>
              </p>
              <button
                onClick={() => { setLinkSent(false); setEmail("") }}
                style={{ background: "none", border: "none", color: LIGHT.action.quietInk, fontSize: 13, fontWeight: 700, cursor: "pointer", marginTop: 16, fontFamily: "inherit" }}
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={sendMagicLink} style={authCard}>
              <label style={authLabel}>Email address</label>
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ ...authInput, marginTop: 8 }}
              />
              {showDevAuth && (
                <>
                  <label style={{ ...authLabel, marginTop: 16, display: "block" }}>
                    Password{" "}
                    <span style={{ color: LIGHT.text.dim, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                      (dev only, leave blank for a magic link)
                    </span>
                  </label>
                  <input
                    type="password"
                    placeholder="dev-test-1234"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        signInWithPassword()
                      }
                    }}
                    style={{ ...authInput, marginTop: 8 }}
                  />
                </>
              )}
              {error && (
                <p style={{ fontSize: 13, color: LIGHT.meaning.error.ink, marginTop: 10 }}>{error}</p>
              )}
              {/* The one action on the screen, so it is the one peach thing. */}
              <button
                type="submit"
                disabled={sending || passwordSubmitting}
                style={{
                  width: "100%",
                  marginTop: 18,
                  padding: "13px 20px",
                  borderRadius: 10,
                  border: "none",
                  fontFamily: "inherit",
                  fontSize: 15,
                  fontWeight: 800,
                  cursor: "pointer",
                  background: LIGHT.action.fill,
                  color: LIGHT.action.ink,
                  boxShadow: LIGHT.action.glow,
                  opacity: sending || passwordSubmitting ? 0.55 : 1,
                }}
              >
                {sending ? "Sending..." : "Send magic link"}
              </button>
              {showDevAuth && (
                <button
                  type="button"
                  onClick={signInWithPassword}
                  disabled={sending || passwordSubmitting || !email.trim() || !password}
                  style={{
                    width: "100%",
                    marginTop: 10,
                    padding: "12px 20px",
                    borderRadius: 10,
                    fontFamily: "inherit",
                    fontSize: 14,
                    fontWeight: 800,
                    cursor: "pointer",
                    background: LIGHT.card,
                    border: `1px solid ${LIGHT.border}`,
                    color: LIGHT.text.secondary,
                    opacity: (sending || passwordSubmitting || !email.trim() || !password) ? 0.5 : 1,
                  }}
                >
                  {passwordSubmitting ? "Signing in..." : "Sign in with password"}
                </button>
              )}
            </form>
          )}
        </div>
      </div>
    )
  }

  // D2C nav, with the coached-only "Coaches Hub" item injected into the
  // MY ACCOUNT group when this account has an active coach. Non-coached D2C
  // users never see it, which is the case for both usability-test students.
  // (is_coach users render COACH_NAV, so the item is D2C-only.) It sits above
  // My Profile so the settings entry stays last in the list.
  const d2cNav: NavGroup[] = coached
    ? D2C_NAV.map((g) => {
        if (g.header !== "MY ACCOUNT") return g
        const items = [...g.items]
        const profileAt = items.findIndex((i) => i.href === "/dashboard/profile")
        const hub: NavItem = {
          href: "/dashboard/coaching-hub",
          label: "Coaches Hub",
          matchPrefix: true,
          icon: <CoachesHubIcon size={20} />,
        }
        items.splice(profileAt === -1 ? items.length : profileAt, 0, hub)
        return { ...g, items }
      })
    : D2C_NAV
  const navGroups = isCoach ? COACH_NAV : d2cNav

  // The one theme switch, in two parts.
  //
  // 1. `isD2C` picks the NAV treatment. Coach accounts and every coach route
  //    keep the dark nav; the pathname check means a coach page is never
  //    briefly light while /api/profile is still resolving.
  // 2. `useLight` picks the GROUND, and is additionally gated on the route
  //    having been redesigned. A converted nav over an unconverted page puts
  //    dark-theme cards and white text on a pale ground, which is unreadable.
  //    So the ground turns on route by route, as each screen lands, and dev
  //    stays runnable instead of half-flipped for days.
  //
  // ADD A ROUTE HERE IN THE SAME COMMIT THAT REDESIGNS IT. Nothing else needs
  // to change: the page starts sitting on the light ground the moment its
  // prefix appears in this list.
  const isD2C = !isCoach && !pathname.startsWith("/dashboard/coach")

  // THE ONE PLACE A COACH ACCOUNT GETS THE LIGHT GROUND: networking.
  //
  // A coach opening a client's networking board is looking at the client's own
  // screen, and the point is that it is the same screen: when the two of them
  // talk about "the card at the top", it has to be the same card. Rendering the
  // light networking pages on the dark coach ground would not just look wrong,
  // it would make the coach's view a different artefact from the client's.
  //
  // THIS IS DELIBERATELY NOT GATED ON A SUBJECT BEING PRESENT, and that is a
  // correction rather than a widening. Gating it on the subject made the shell
  // depend on a query parameter surviving every link in the tree, so ONE link
  // that forgot to carry it produced navy text on a navy ground. A missing
  // subject is a real bug and it must be fixed where it happens, but it must
  // not also make the page unreadable: those are separate failures and tying
  // them together meant the cheap one could hide behind the loud one. A coach
  // on their OWN networking board reaches the same pages and needs them legible
  // for exactly the same reason.
  //
  // Still narrow: NETWORKING routes only, and isLightRoute still gates each one
  // on having actually been redesigned. The coach tracker, profile and Coaches
  // Center surfaces are untouched.
  const onNetworking = pathname.startsWith("/dashboard/network")
  const coachOnClientBoard = isCoach && boardClientId !== null
  const useLight = (isD2C || (isCoach && onNetworking)) && isLightRoute(pathname)
  const S = LIGHT

  // Nav chrome. Navy in both themes because navy is structure; only the active
  // treatment differs. No peach anywhere: a nav item is a place, not an action.
  // Keyed on isD2C, not useLight: the nav is redesigned for every student route
  // straight away. It reads correctly against both a light ground and a dark
  // one, because navy sits happily next to either.
  const navBg = isD2C ? "linear-gradient(180deg, #13294A 0%, #0E1F38 100%)" : T.NAV_BG
  const navBorder = isD2C ? "rgba(255,255,255,0.10)" : T.BORDER_SOFT
  const navHeaderInk = isD2C ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.42)"
  const navHeaderHotInk = isD2C ? "#FFFFFF" : T.WRN_ORANGE
  const navIdleInk = isD2C ? S.hero.muted : T.TEXT
  const navActiveInk = isD2C ? "#FFFFFF" : T.WRN_ORANGE
  const navActiveBg = isD2C ? "rgba(255,255,255,0.12)" : T.NAV_ACTIVE_BG
  const navActiveBorder = isD2C ? "rgba(255,255,255,0.16)" : T.NAV_ACTIVE_BORDER

  return (
    <div style={{ minHeight: "100vh", background: useLight ? S.page : T.BG, display: "flex", flexDirection: "column" }}>
      {coachOnClientBoard && boardClientId && (
        <CoachBoardBar clientId={boardClientId} clientName={boardClientName} />
      )}
      {(fromFramer || returnRun) && (
        <FramerBanner runId={returnRun} jobTitle={returnTitle} />
      )}
      {handoffDegraded && <HandoffDegradedBanner />}
      <div style={{ display: "flex", flex: 1 }}>
        <nav style={{ width: 220, background: navBg, borderRight: `1px solid ${navBorder}`, flexShrink: 0, display: "flex", flexDirection: "column" }}>
          <Logo />
          <div style={{ padding: "0 12px" }}>
            {navGroups.map((group, gi) => {
              const groupHot = isGroupActive(group, pathname)
              return (
                <div key={group.header} style={{ marginBottom: gi === navGroups.length - 1 ? 12 : 16 }}>
                  <div style={{
                    ...eyebrow, fontSize: 11, letterSpacing: 1.2,
                    color: groupHot ? navHeaderHotInk : navHeaderInk,
                    padding: "0 8px", marginBottom: 8,
                  }}>
                    {group.header}
                  </div>
                  {group.items.map((item) => {
                    const active = isItemActive(item, pathname)
                    // A parent stays lit for its whole section, so Networking
                    // reads as current while you are on Contacts.
                    const sectionOpen =
                      active ||
                      (item.children ?? []).some((c) => isItemActive(c, pathname))
                    const itemStyle: React.CSSProperties = {
                      display: "block",
                      padding: "10px 12px",
                      marginBottom: 4,
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 900,
                      textDecoration: "none",
                      border: sectionOpen
                        ? `1px solid ${navActiveBorder}`
                        : `1px solid ${isD2C ? "transparent" : T.BORDER_SOFT}`,
                      background: sectionOpen ? navActiveBg : (isD2C ? "transparent" : T.NAV_DEFAULT_BG),
                      color: sectionOpen ? navActiveInk : navIdleInk,
                      ...(item.icon ? { display: "flex", alignItems: "center", gap: 11 } : null),
                    }
                    // Sub-nav, rendered only while its section is open. Indented
                    // and one weight quieter so the parent still reads as the
                    // place and these read as views inside it.
                    const subNav =
                      item.children && sectionOpen ? (
                        <div style={{ margin: "0 0 8px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
                          {item.children.map((child) => {
                            const childActive = isItemActive(child, pathname)
                            return (
                              <a
                                key={child.href}
                                href={child.href}
                                style={{
                                  display: "block",
                                  padding: "7px 12px",
                                  borderRadius: 8,
                                  fontSize: 12.5,
                                  fontWeight: childActive ? 800 : 600,
                                  textDecoration: "none",
                                  color: childActive ? "#FFFFFF" : navIdleInk,
                                  background: childActive
                                    ? (isD2C ? "rgba(255,255,255,0.09)" : T.NAV_ACTIVE_BG)
                                    : "transparent",
                                  ...(child.icon ? { display: "flex", alignItems: "center", gap: 9 } : null),
                                }}
                              >
                                {child.icon}
                                <span>{child.label}</span>
                              </a>
                            )
                          })}
                        </div>
                      ) : null

                    // Disabled "Soon" domain — greyed, non-clickable, no nav.
                    // Mirrors the disabled-item treatment formerly in the
                    // settings sub-nav.
                    if (item.disabled) {
                      return (
                        <div
                          key={item.label}
                          style={{
                            ...itemStyle,
                            border: `1px solid ${T.BORDER_SOFT}`,
                            background: "transparent",
                            color: T.DIM,
                            cursor: "default",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <span>{item.label}</span>
                          <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase", color: T.DIM }}>
                            Soon
                          </span>
                        </div>
                      )
                    }
                    // Action items render as a <button> instead of navigating —
                    // Feedback opens the slide-in, Log out tears down the
                    // session. Same nav-item style as links, button defaults
                    // reset to match an <a>.
                    if (item.action) {
                      const onClick = item.action === "feedback" ? () => setFeedbackOpen(true) : handleLogout
                      return (
                        <button
                          key={item.label}
                          type="button"
                          onClick={onClick}
                          style={{
                            ...itemStyle,
                            width: "100%",
                            textAlign: "left",
                            cursor: "pointer",
                            fontFamily: "inherit",
                            boxSizing: "border-box",
                          }}
                        >
                          {item.icon}
                          <span>{item.label}</span>
                        </button>
                      )
                    }
                    return (
                      <div key={item.href}>
                        <a
                          href={item.href}
                          style={itemStyle}
                          {...(item.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                        >
                          {item.icon}
                          <span>{item.label}</span>
                        </a>
                        {subNav}
                      </div>
                    )
                  })}
                </div>
              )
            })}

            {/* Back to SIGNAL — external job-seeker product. D2C only:
                coaches operate strictly as coaches (separate account for
                job-seeking), so this context switch is hidden in coach nav.
                Spec §0.2. */}
            {!isCoach && (
            <a
              key={EXTERNAL_NAV_ITEM.href}
              href={EXTERNAL_NAV_ITEM.href}
              onClick={async (e) => {
                e.preventDefault()
                const supabase = getSupabaseBrowser()
                const { data } = await supabase.auth.getSession()
                const token = data.session?.access_token
                const refreshToken = data.session?.refresh_token
                const params = new URLSearchParams()
                if (token) params.set("access_token", token)
                if (refreshToken) params.set("refresh_token", refreshToken)
                window.location.replace(EXTERNAL_NAV_ITEM.href + "#" + params.toString())
              }}
              style={{
                display: "block",
                marginTop: 8,
                padding: "10px 12px",
                marginBottom: 4,
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 900,
                textDecoration: "none",
                border: isD2C
                  ? "1px solid rgba(255,255,255,0.16)"
                  : "1px solid rgba(74,222,128,0.3)",
                background: isD2C ? "transparent" : "rgba(74,222,128,0.06)",
                // Not green, not peach. On light this is a context switch out to
                // the Framer tools, so it takes the hero link blue.
                color: isD2C ? S.hero.link : "#4ade80",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 11 }}>
                {isD2C && <ScoreAJobIcon size={20} />}
                <span>{EXTERNAL_NAV_ITEM.label}</span>
              </span>
            </a>
            )}
          </div>
        </nav>
        <main
          style={{
            flex: 1,
            padding: isD2C ? "36px 44px 72px 40px" : "32px 40px 60px 36px",
            overflowY: "auto",
            color: useLight ? S.text.primary : undefined,
          }}
        >
          {children}
        </main>
      </div>
      {/* Beta-feedback slide-in — coaches only. Trigger wired into the nav
          in Phase 4; mounted here so it's reachable from any coach page. */}
      {isCoach && (
        <FeedbackSlideIn
          open={feedbackOpen}
          onClose={() => setFeedbackOpen(false)}
          authToken={authToken ?? ""}
        />
      )}
    </div>
  )
}
