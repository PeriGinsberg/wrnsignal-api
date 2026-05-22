"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { T, eyebrow } from "../../../../../../lib/dashboard-theme"
import { Avatar } from "./Avatar"
import { LifecycleStatusPill, type LifecycleStatus } from "../../../LifecycleStatusPill"
import { useDropdownPlacement } from "../../../useDropdownPlacement"

// Overflow menu has 1 item × ~36px row + 12px padding = ~48px. Bumped
// to 60 for headroom. The overflow trigger lives in the page header
// (top of viewport), so realistically the dropdown will always have
// room below — but the hook costs nothing and keeps the pattern
// consistent across all three coach-side dropdowns.
const OVERFLOW_MENU_HEIGHT_ESTIMATE = 60

export type ClientHeaderProfile = {
  id: string
  name: string | null
  email: string | null
  job_type: string | null
  target_roles: string | null
  target_locations: string | null
  timeline: string | null
  // Engagement start. Falls back to client_profiles.created_at if no
  // coach_clients.accepted_at is available.
  engagement_started_at: string | null
}

type Props = {
  profile: ClientHeaderProfile
  lifecycleStatus: LifecycleStatus
  getToken: () => Promise<string | null>
  onAddNote: () => void
  onSourceJob: () => void
  onRemoveClient: () => void
  onLifecycleStatusChange: (next: LifecycleStatus) => void
}

// Renders the persistent header strip: avatar + name + summary line +
// engagement-start date + lifecycle badge + action buttons.
export function ClientHeaderStrip({
  profile,
  lifecycleStatus,
  getToken,
  onAddNote,
  onSourceJob,
  onRemoveClient,
  onLifecycleStatusChange,
}: Props) {
  const router = useRouter()
  const [overflowOpen, setOverflowOpen] = useState(false)
  const overflowWrapRef = useRef<HTMLDivElement | null>(null)
  const overflowPlacement = useDropdownPlacement(
    overflowWrapRef,
    overflowOpen,
    OVERFLOW_MENU_HEIGHT_ESTIMATE,
  )

  // Build summary line from the four populated fields, in order:
  // FT/internship · target roles · timeframe · location. Empty fields
  // hidden silently per spec. (school + year are not in schema; see
  // discovery notes — header omits them.)
  const summaryParts = [
    profile.job_type,
    profile.target_roles,
    profile.timeline,
    profile.target_locations,
  ].filter((v): v is string => !!v && v.trim().length > 0)

  const engagementStart = profile.engagement_started_at
    ? new Date(profile.engagement_started_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null

  return (
    <div
      style={{
        background: "rgba(254,176,106,0.07)",
        border: "1px solid rgba(254,176,106,0.18)",
        borderRadius: 14,
        padding: "16px 22px",
        marginBottom: 24,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 18,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0, flex: 1 }}>
        <Avatar name={profile.name} email={profile.email} size={56} />
        <div style={{ minWidth: 0 }}>
          <div style={{ ...eyebrow, color: T.WRN_ORANGE, fontSize: 9, marginBottom: 4 }}>
            COACHING SESSION
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 950,
              color: T.TEXT,
              letterSpacing: -0.4,
              lineHeight: 1.15,
            }}
          >
            {profile.name || profile.email || "Client"}
          </div>
          {summaryParts.length > 0 && (
            <div
              style={{
                fontSize: 12,
                color: T.MUTED,
                marginTop: 4,
                lineHeight: 1.5,
              }}
            >
              {summaryParts.join(" · ")}
            </div>
          )}
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
            <LifecycleStatusPill
              value={lifecycleStatus}
              getToken={getToken}
              clientProfileId={profile.id}
              onChange={onLifecycleStatusChange}
              size="md"
            />
            {engagementStart && (
              <span style={{ fontSize: 11, color: T.DIM }}>
                Client since {engagementStart}
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <ActionButton onClick={onSourceJob} accent="orange">
          Source a Job
        </ActionButton>
        <ActionButton onClick={onAddNote} accent="orange">
          + Add Note
        </ActionButton>
        <ActionButton accent="muted" disabled title="Calendly integration coming soon">
          Schedule
        </ActionButton>
        <div ref={overflowWrapRef} style={{ position: "relative" }}>
          <button
            onClick={() => setOverflowOpen((v) => !v)}
            aria-label="More actions"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${T.BORDER_SOFT}`,
              color: T.MUTED,
              fontSize: 14,
              fontWeight: 900,
              borderRadius: 10,
              padding: "8px 12px",
              cursor: "pointer",
              letterSpacing: 0.4,
            }}
          >
            ⋯
          </button>
          {overflowOpen && (
            <>
              {/* Click-outside catcher. Stays z-below the menu so the
                  menu stays clickable. */}
              <div
                onClick={() => setOverflowOpen(false)}
                style={{ position: "fixed", inset: 0, zIndex: 30 }}
              />
              <div
                style={{
                  position: "absolute",
                  [overflowPlacement === "up" ? "bottom" : "top"]: "calc(100% + 6px)",
                  right: 0,
                  background: T.NAV_BG,
                  border: `1px solid ${T.BORDER}`,
                  borderRadius: 10,
                  boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
                  padding: 6,
                  minWidth: 180,
                  zIndex: 31,
                }}
              >
                <button
                  onClick={() => {
                    setOverflowOpen(false)
                    onRemoveClient()
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#f87171",
                    fontSize: 12,
                    fontWeight: 700,
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 12px",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  Remove client
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ActionButton({
  children,
  onClick,
  accent,
  disabled,
  title,
}: {
  children: React.ReactNode
  onClick?: () => void
  accent: "orange" | "muted"
  disabled?: boolean
  title?: string
}) {
  const styles =
    accent === "orange" && !disabled
      ? {
          background: "rgba(254,176,106,0.10)",
          border: "1px solid rgba(254,176,106,0.35)",
          color: T.WRN_ORANGE,
        }
      : {
          background: "rgba(255,255,255,0.03)",
          border: `1px solid ${T.BORDER_SOFT}`,
          color: T.DIM,
        }
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      style={{
        ...styles,
        fontSize: 12,
        fontWeight: 900,
        borderRadius: 10,
        padding: "8px 14px",
        cursor: disabled ? "not-allowed" : "pointer",
        letterSpacing: 0.4,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}
