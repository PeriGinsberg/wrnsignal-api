"use client"

// My Profile — one home for everything about the student.
//
// This is the last Phase A screen, and it exists mostly to retire things. Three
// temporary entries added while the redesign was in flight all land here:
//
//   the LEGACY ACCOUNT PANEL, the whole old /dashboard page (personas, coach
//   recommendations, refund), parked at the bottom of this route and still
//   dark. Personas became Resume > Resume versions, the refund became Account.
//
//   the NETWORKING PROFILE nav entry, a sub-item under Networking pointing at
//   /dashboard/network/profile. It is now the Networking section here, and that
//   route redirects.
//
//   LOG OUT, a nav item with no designed home. It is now Account > Sign out.
//
// SECTIONS LIVE IN THE URL (?section=resume) so a section is linkable, survives
// a refresh, and Back steps between them. Same decision as the tracker's tabs.
//
// NOT BUILT: the Notifications section from the mockup. There is no
// notification-settings data anywhere in the schema — no table, no columns, no
// endpoint — so it would be a menu item leading to an empty page. Flagged
// rather than stubbed.

import { Suspense, useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { LIGHT as S } from "../../../lib/theme/surfaces"
import { AccountIcon, ResumeIcon, ProfileIcon } from "../../../components/icons"
import { authFetch } from "../network/authFetch"
import { profileCompletion } from "../dashboardState"
import { BasicsSection, type Profile } from "./BasicsSection"
import { ResumeSection } from "./ResumeSection"
import { AccountSection } from "./AccountSection"

// THE NETWORKING SECTION IS GONE, with the templates and the merge variables
// it existed to feed. It rendered ProfileForm from network/profile, which read
// and wrote /api/network/profile; both are deleted. network_client_profile
// keeps its 15 rows, unread.
//
// An old ?section=networking link does not 404: the guard below falls back to
// "basics" for any key not in this list, which is what it always did for a
// typo and is now what it does for a retirement.
const SECTIONS = [
  { key: "basics", label: "Basics", icon: <ProfileIcon size={19} /> },
  { key: "resume", label: "Resume", icon: <ResumeIcon size={19} /> },
  { key: "account", label: "Account", icon: <AccountIcon size={19} /> },
] as const

type SectionKey = (typeof SECTIONS)[number]["key"]

export default function MyProfilePage() {
  return (
    <Suspense fallback={<p style={{ color: S.text.muted, fontSize: 14.5 }}>Loading…</p>}>
      <MyProfile />
    </Suspense>
  )
}

function MyProfile() {
  const router = useRouter()
  const params = useSearchParams()
  const raw = params.get("section")
  const section: SectionKey = SECTIONS.some((s) => s.key === raw) ? (raw as SectionKey) : "basics"

  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await authFetch("/api/profile")
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.profile) throw new Error("We couldn't load your profile. Refresh to try again.")
      setProfile(j.profile)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  /**
   * One writer for the whole page. Returns success so a section can show its
   * own Saved state without each one re-implementing the fetch and the error.
   * `preferred_locations` is destructured out: the field was removed from the
   * UI and the column stays as inert dead storage, so writing it back would
   * resurrect a value nobody can see or edit.
   */
  const save = useCallback(async (patch: Partial<Profile>): Promise<boolean> => {
    if (!profile) return false
    setErr(null)
    // Send ONLY what this section edits, not the whole loaded profile echoed
    // back. The old forms resubmitted everything they had received, which is
    // how a computed field from the GET (`coached`) ended up in a write and
    // broke every save. The server now allowlists too, so this is the second
    // of two locks rather than the only one.
    const res = await authFetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setErr(j?.error || "That didn't save. Try again.")
      return false
    }
    const j = await res.json()
    setProfile(j.profile)
    return true
  }, [profile])

  function go(next: SectionKey) {
    router.replace(next === "basics" ? "/dashboard/profile" : `/dashboard/profile?section=${next}`)
  }

  if (loading) return <p style={{ color: S.text.muted, fontSize: 14.5 }}>Loading…</p>

  if (!profile) {
    return (
      <main style={{ maxWidth: 1080 }}>
        <p style={{ color: S.meaning.error.ink, fontSize: 15 }}>{err ?? "We couldn't load your profile."}</p>
      </main>
    )
  }

  const { percent, missing } = profileCompletion(profile)

  return (
    <main style={{ maxWidth: 1080 }}>
      <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.5, color: S.text.primary, margin: 0 }}>
        My Profile
      </h1>
      <p style={{ color: S.text.muted, fontSize: 15, margin: "6px 0 0" }}>
        Everything SIGNAL uses to personalise your search. Fill it once, tweak whenever.
      </p>

      {/* The completeness bar, only while there is something to finish. At 100%
          it is a trophy nobody asked for, and the space is better spent on the
          form. This is the same measure the Dashboard's new-student state uses,
          so the two can never disagree. */}
      {missing > 0 && (
        <section
          style={{
            background: S.hero.background, borderRadius: 16,
            padding: "20px 24px", marginTop: 22,
            display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap",
          }}
        >
          <div style={{ flex: "1 1 320px", minWidth: 240 }}>
            <div style={{ color: S.hero.ink, fontSize: 17, fontWeight: 800 }}>
              Your profile is {percent}% complete
            </div>
            <div style={{ height: 9, borderRadius: 999, background: "rgba(255,255,255,0.14)", marginTop: 12 }}>
              <div style={{ width: `${percent}%`, height: "100%", borderRadius: 999, background: S.hero.accent }} />
            </div>
          </div>
          <span style={{ color: S.hero.muted, fontSize: 14.5, whiteSpace: "nowrap" }}>
            {missing} {missing === 1 ? "field" : "fields"} left
          </span>
        </section>
      )}

      {err && (
        <div
          style={{
            marginTop: 18, padding: "12px 16px", borderRadius: 12,
            background: S.meaning.error.fill, color: S.meaning.error.ink, fontSize: 14, fontWeight: 700,
          }}
        >
          {err}
        </div>
      )}

      <div style={{ display: "flex", gap: 20, marginTop: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* The section menu. A real list of buttons rather than a tab strip,
            because five settings sections read as a table of contents and a
            horizontal strip of five would wrap awkwardly at any narrow width. */}
        <nav
          aria-label="Profile sections"
          style={{ flex: "0 0 232px", display: "flex", flexDirection: "column", gap: 4, minWidth: 200 }}
        >
          {SECTIONS.map((s) => {
            const active = section === s.key
            return (
              <button
                key={s.key}
                onClick={() => go(s.key)}
                aria-current={active ? "page" : undefined}
                style={{
                  display: "flex", alignItems: "center", gap: 12, textAlign: "left",
                  background: active ? S.card : "transparent",
                  border: `1px solid ${active ? S.borderSoft : "transparent"}`,
                  boxShadow: active ? S.shadow.card : "none",
                  color: active ? S.text.primary : S.text.muted,
                  borderRadius: 12, padding: "13px 16px", fontSize: 15,
                  fontWeight: active ? 800 : 700, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {s.icon}
                {s.label}
              </button>
            )
          })}
        </nav>

        <section
          style={{
            flex: "1 1 460px", minWidth: 280,
            background: S.card, border: `1px solid ${S.borderSoft}`,
            borderRadius: 16, boxShadow: S.shadow.card, padding: "28px 32px",
          }}
        >
          {section === "basics" && <BasicsSection profile={profile} onSave={save} />}
          {section === "resume" && <ResumeSection profile={profile} onSave={save} />}
          {section === "account" && <AccountSection profile={profile} />}
        </section>
      </div>
    </main>
  )
}
