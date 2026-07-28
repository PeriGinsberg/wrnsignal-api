// app/dashboard/network/vocab.ts
// Single source of truth for the v3 display vocabulary shared across the
// network UI (worklist row, roster, contact record, action log). Keeping these
// in one file avoids the label drift that comes from re-declaring maps per
// component. Engine/DB vocabulary lives in lib/network-tracker/reminder-engine.ts
// and the migration; this is purely presentational.

import { pillStyle, type PhaseKey } from "../../../lib/dashboard-theme"

// Display labels only — the KEYS are the DB/engine stage values (unchanged); the
// VALUES are plain-English UI copy. Every surface (stepper, roster, worklist,
// filters, dropdowns, prose) reads from here — never hardcode a stage's wording.
export const STAGE_LABELS: Record<string, string> = {
  identified: "Not contacted",
  intro_requested: "Intro requested",
  sequence_active: "Message sent",
  replied: "They replied",
  chat_scheduled: "Chat scheduled",
  chat_done: "Chat happened",
  nurture: "Keeping in touch",
  ask_made: "Asked for referral",
  outcome: "Outcome",
  dormant_no_answer: "No answer",
  dormant_declined: "Declined",
}

// Stage → PHASE GROUP. The single source of truth for how a stage is coloured
// anywhere it appears: the spreadsheet's stage pill, the dashboard funnel, and
// any future surface. Colour by group, never one colour per stage — 11 colours
// is noise. The palette itself (fg/bg per phase) is in lib/dashboard-theme.ts
// `PHASE`; this file only decides which stage belongs to which group.
//
// Replaces the former STAGE_COLOR map, which assigned per-stage colours on a
// different grouping and was referenced nowhere.
export const STAGE_PHASE: Record<string, PhaseKey> = {
  identified: "idle",              // not started
  intro_requested: "active",       // in progress
  sequence_active: "active",
  replied: "alive",                // alive
  chat_scheduled: "momentum",      // momentum
  chat_done: "momentum",
  nurture: "longgame",             // long game
  ask_made: "longgame",
  outcome: "won",                  // won
  dormant_no_answer: "resting",    // resting
  dormant_declined: "resting",
}

// Convenience for the common case: give me the pill styling for this stage.
// Unknown/absent stage falls back to the neutral group rather than throwing.
export function stagePillStyle(stage: string): React.CSSProperties {
  return pillStyle(STAGE_PHASE[stage] ?? "idle")
}

// Display names for the seven groups. The dashboard funnel and the stage pill
// both read these, so the two surfaces can never drift apart in wording.
export const PHASE_LABELS: Record<PhaseKey, string> = {
  idle: "Not started",
  active: "In progress",
  alive: "Replied",
  momentum: "Talking",
  longgame: "Nurture & ask",
  won: "Outcome",
  resting: "Resting",
}

// Canonical order. `resting` is last and is deliberately NOT a step of
// progress — dormant contacts haven't advanced, they've stopped — so the
// dashboard renders it BESIDE the funnel as a count rather than as a bar.
// It still belongs in the shared mapping because it's a real state that needs
// its own colour; excluding it is what let the pill and the funnel disagree.
export const PHASE_ORDER: PhaseKey[] = ["idle", "active", "alive", "momentum", "longgame", "won", "resting"]
export const FUNNEL_PHASES: PhaseKey[] = PHASE_ORDER.filter((p) => p !== "resting")

// Stages belonging to a phase — what the funnel deep-links into when a group is
// clicked (Contacts filtered to those stages).
export function stagesInPhase(phase: PhaseKey): string[] {
  return Object.entries(STAGE_PHASE).filter(([, p]) => p === phase).map(([stage]) => stage)
}

// ─── Company board ───────────────────────────────────────────────────────────
// TIER is company-level: how much the client wants to work there. Distinct from
// contact-level PRIORITY (A/B/C) — one word each, no collision. UI label "Tier".
// DISPLAY ONLY. The DB values stay dream/strong/backup — the CHECK constraint,
// the routes, and every stored row are untouched. Renaming here is a pure
// relabel, exactly like STAGE_LABELS maps `identified` to "Not contacted".
export const TIER_LABELS: Record<string, string> = {
  dream: "Tier 1",
  strong: "Tier 2",
  backup: "Tier 3",
}

// `tier` is nullable, so the board always has an untiered bucket. UNSORTED is a
// UI-only key — it is never written to the DB, it stands for `tier IS NULL`.
export const UNSORTED_TIER = "__unsorted__"
export const TIER_GROUP_LABELS: Record<string, string> = {
  [UNSORTED_TIER]: "Not Categorized",
  ...TIER_LABELS,
}

// "Not Categorized" sits FIRST, deliberately. A company with no tier is
// untriaged, not low-value; putting it at the bottom would bury it forever. Top
// reads as "sort me" — the same reasoning that floats no-activity contacts to
// the top of the roster. TIER_ORDER holds KEYS; the wording lives in
// TIER_GROUP_LABELS above, so ordering and labelling never drift apart.
export const TIER_ORDER: string[] = [UNSORTED_TIER, "dream", "strong", "backup"]

// Names of the FIELDS themselves, as distinct from the values inside them.
// A pill showing "Tier 1" says nothing about which field it is; the label beside
// it does. One source so "Tier" can't read "Tier" here and "Priority" there.
export const FIELD_LABELS = {
  tier: "Tier",
  status: "Status",
  stage: "Stage",
  relationship: "Relationship",
  priority: "Priority",
  segment: "Segment",
} as const

export const STATUS_LABELS: Record<string, string> = {
  researching: "Researching",
  actively_working: "Actively working",
  paused: "Paused",
  closed: "Closed",
}

// `status` is nullable too. Blank renders as an em dash — NOT defaulted to
// "Researching", because the board must not assert something the user never said.
export function statusLabel(status: string | null | undefined): string {
  return status ? (STATUS_LABELS[status] ?? status) : "—"
}

// What "Logged it" writes for a given due reason (worklist quick action).
export const REASON_TO_ACTION: Record<string, string> = {
  touch_2: "touch_2",
  touch_3: "touch_3",
  intro_chase: "intro_request",
  reply: "note_logged",
  thank_you: "thank_you",
  nurture_recurring: "note_logged",
  ask_followup: "note_logged",
  resurface_no_answer: "touch_1",
  resurface_declined: "touch_1",
  poke: "touch_1",
  manual: "note_logged",
}

// Display labels for the due reason — imperative ("what to do next"), since the
// worklist shows this as the action. Keys are engine values (unchanged).
export const REASON_LABELS: Record<string, string> = {
  touch_2: "Send follow-up",
  touch_3: "Send final follow-up",
  intro_chase: "Follow up on intro request",
  reply: "Send a reply",
  thank_you: "Send thank-you",
  nurture_recurring: "Send a check-in",
  ask_followup: "Follow up on referral ask",
  resurface_no_answer: "Time to try again",
  resurface_declined: "Time to reconnect",
  poke: "Reach out",
  manual: "Your reminder",
}

export const RELATIONSHIP_LABEL: Record<string, string> = {
  personal: "Personal",
  affinity: "Affinity",
  referred: "Referred",
  cold: "Cold",
  recruiter: "Recruiter",
}

export const RELATIONSHIPS = ["personal", "affinity", "referred", "cold", "recruiter"] as const
export const PRIORITIES = ["A", "B", "C"] as const

// Action-log dropdown (the type vocabulary in the migration).
export const ACTION_TYPE_OPTIONS: { key: string; label: string }[] = [
  { key: "touch_1", label: "Touch 1 (first outreach)" },
  { key: "touch_2", label: "Touch 2" },
  { key: "touch_3", label: "Touch 3" },
  { key: "intro_request", label: "Intro request" },
  { key: "thank_you", label: "Thank-you" },
  { key: "connection_request", label: "Connection request" },
  { key: "engage_on_post", label: "Engaged on a post" },
  { key: "chat_scheduled", label: "Chat scheduled" },
  { key: "chat_done", label: "Chat done" },
  { key: "ask", label: "Ask" },
  { key: "note_logged", label: "Note" },
  { key: "other", label: "Other" },
]
export const ACTION_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  ACTION_TYPE_OPTIONS.map((o) => [o.key, o.label]),
)
