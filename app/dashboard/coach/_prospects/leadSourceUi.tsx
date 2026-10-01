"use client"

// Lead source, referred-by and parent contact, as every prospect screen shows
// and edits them. The vocabulary is lib/prospects/model.ts; this is its look.
// Used by the Add Prospect form, the prospect page, the consult screen, the
// prospect list, the converted-client page and the client page, which until
// 2026-10-02 each carried their own copy of the list.

import { T, input, label, selectDarkInk, selectDarkOption } from "../../../../lib/dashboard-theme"
import {
  LEAD_SOURCES,
  LEAD_SOURCE_LABEL,
  isStoredLeadSource,
  leadSourceLabel,
  takesReferredBy,
  type StoredLeadSource,
} from "../../../../lib/prospects/model"

export type LeadSourceStyle = { bg: string; color: string; border: string }

const BLUE: LeadSourceStyle = { bg: "rgba(81,173,229,0.12)", color: T.INK_LINK, border: "rgba(81,173,229,0.40)" }
const GREEN: LeadSourceStyle = { bg: "rgba(0,179,179,0.15)", color: T.SUCCESS, border: "rgba(0,179,179,0.40)" }
const PURPLE: LeadSourceStyle = { bg: "rgba(167,139,250,0.18)", color: "var(--sig-avatar-2-ink, #C8B6F8)", border: "rgba(167,139,250,0.40)" }
const TEAL: LeadSourceStyle = { bg: "rgba(45,165,141,0.15)", color: T.INK_EMPHASIS, border: "rgba(45,165,141,0.40)" }
const DIM: LeadSourceStyle = { bg: T.BORDER_SOFT, color: T.MUTED, border: T.BORDER }

// Grouped by kind: people who referred them, social, found us themselves.
const STYLE: Record<StoredLeadSource, LeadSourceStyle> = {
  friend_family: GREEN,
  past_client: BLUE,
  online_community: PURPLE,
  instagram_tiktok: PURPLE,
  google_search: TEAL,
  ad: TEAL,
  free_resource: TEAL,
  other: DIM,
  referral: BLUE,
  personal_contact: GREEN,
  social_media: PURPLE,
  website: TEAL,
}

export function leadSourceStyle(source: string | null | undefined): LeadSourceStyle {
  return (source && isStoredLeadSource(source) && STYLE[source]) || DIM
}

/** The source as a pill. Other shows its specify text when there is one. */
export function LeadSourceBadge({ source, detail }: { source: string | null | undefined; detail?: string | null }) {
  if (!source) return <span style={{ color: T.DIM }}>—</span>
  const s = leadSourceStyle(source)
  const text = source === "other" && detail ? `Other: ${detail}` : leadSourceLabel(source)
  return (
    <span
      style={{
        display: "inline-block", background: s.bg, color: s.color,
        fontSize: 11, fontWeight: 900, letterSpacing: 0.4,
        padding: "3px 10px", borderRadius: 999,
      }}
    >
      {text}
    </span>
  )
}

export type LeadSourceValue = {
  source_category: string
  source_detail: string
  referred_by_name: string
  referred_by_email: string
}

const fieldLabel = { ...label, color: T.INK_LINK, display: "block", marginBottom: 6 } as const
const optional = <span style={{ color: T.DIM, fontWeight: 400 }}>(optional)</span>

/**
 * The lead source select, its "Other: specify" box, and "Referred by" (name,
 * optional email) when the source is a friend or family member or a past
 * client. A prospect still holding a pre-2026-10-02 source shows it as the
 * current choice until a new one is picked.
 */
export function LeadSourceFields(props: {
  value: LeadSourceValue
  onChange: (next: LeadSourceValue) => void
  idPrefix: string
  error?: string | null
}) {
  const { value, onChange, idPrefix } = props
  const set = (k: keyof LeadSourceValue, v: string) => onChange({ ...value, [k]: v })
  const legacy = value.source_category && !(LEAD_SOURCES as readonly string[]).includes(value.source_category)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <label htmlFor={`${idPrefix}-source`} style={{ display: "block" }}>
        <span style={fieldLabel}>HOW DID THEY HEAR ABOUT US?</span>
        <select
          id={`${idPrefix}-source`}
          style={{ ...input, ...selectDarkInk }}
          value={value.source_category}
          onChange={(e) => set("source_category", e.target.value)}
        >
          <option value="" style={selectDarkOption}>Select…</option>
          {legacy && (
            <option value={value.source_category} style={selectDarkOption}>
              {LEAD_SOURCE_LABEL[value.source_category as StoredLeadSource] ?? value.source_category} (older option)
            </option>
          )}
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s} style={selectDarkOption}>{LEAD_SOURCE_LABEL[s]}</option>
          ))}
        </select>
      </label>
      {props.error && <div style={{ fontSize: 12, color: T.ERROR, fontWeight: 700 }}>{props.error}</div>}

      {value.source_category === "other" && (
        <label htmlFor={`${idPrefix}-source-detail`} style={{ display: "block" }}>
          <span style={fieldLabel}>PLEASE SPECIFY</span>
          <input
            id={`${idPrefix}-source-detail`}
            type="text"
            style={input}
            value={value.source_detail}
            maxLength={500}
            onChange={(e) => set("source_detail", e.target.value)}
          />
        </label>
      )}

      {takesReferredBy(value.source_category) && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <label htmlFor={`${idPrefix}-referred-name`} style={{ display: "block", flex: "1 1 180px" }}>
            <span style={fieldLabel}>REFERRED BY {optional}</span>
            <input
              id={`${idPrefix}-referred-name`}
              type="text"
              style={input}
              placeholder="Their name"
              value={value.referred_by_name}
              maxLength={200}
              onChange={(e) => set("referred_by_name", e.target.value)}
            />
          </label>
          <label htmlFor={`${idPrefix}-referred-email`} style={{ display: "block", flex: "1 1 180px" }}>
            <span style={fieldLabel}>THEIR EMAIL {optional}</span>
            <input
              id={`${idPrefix}-referred-email`}
              type="email"
              style={input}
              value={value.referred_by_email}
              onChange={(e) => set("referred_by_email", e.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  )
}

/** The request keys for a lead source edit. Referred-by is sent only where it applies. */
export function leadSourcePayload(v: LeadSourceValue): Record<string, string | null> {
  const out: Record<string, string | null> = {
    source_category: v.source_category || null,
    source_detail: v.source_category === "other" ? v.source_detail.trim() || null : null,
  }
  if (takesReferredBy(v.source_category)) {
    out.referred_by_name = v.referred_by_name.trim() || null
    out.referred_by_email = v.referred_by_email.trim() || null
  }
  return out
}

export type ParentValue = { parent_name: string; parent_email: string; parent_phone: string }

/** Parent or guardian contact. Every field optional. */
export function ParentFields(props: { value: ParentValue; onChange: (next: ParentValue) => void; idPrefix: string }) {
  const { value, onChange, idPrefix } = props
  const set = (k: keyof ParentValue, v: string) => onChange({ ...value, [k]: v })
  const fields: { key: keyof ParentValue; text: string; type: string; max: number }[] = [
    { key: "parent_name", text: "PARENT / GUARDIAN NAME", type: "text", max: 200 },
    { key: "parent_email", text: "PARENT EMAIL", type: "email", max: 320 },
    { key: "parent_phone", text: "PARENT PHONE", type: "tel", max: 50 },
  ]
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {fields.map((f) => (
        <label key={f.key} htmlFor={`${idPrefix}-${f.key}`} style={{ display: "block", flex: "1 1 160px" }}>
          <span style={fieldLabel}>{f.text} {optional}</span>
          <input
            id={`${idPrefix}-${f.key}`}
            type={f.type}
            style={input}
            value={value[f.key]}
            maxLength={f.max}
            onChange={(e) => set(f.key, e.target.value)}
          />
        </label>
      ))}
    </div>
  )
}
