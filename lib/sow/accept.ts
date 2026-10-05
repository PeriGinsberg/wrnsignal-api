// lib/sow/accept.ts
//
// Let's Go: the client accepts the SOW from their private link. In order:
//
//   1. record it: the typed name and the time, against the copy that was sent;
//      only the first click counts (the update is conditional on "sent")
//   2. approve the package; plan tasks activate as when the coach approves
//   3. a prospect moves through SOW Executed to Onboarding
//   4. make the Drive workspace (or keep the one already on the record)
//   5. flag the welcome task: "Send welcome email (releases: [task])"
//   6. a "Send invoice to [name]" task, with the accepted SOW's price and terms
//   7. History, and an email to the coach; both warn if the package changed
//      after the SOW was sent
//   8. sow.accepted, which cancels the 3-day follow-up
//
// 2 and 3 are the acceptance; 4 to 8 never undo it. A Drive failure becomes a
// task for the coach instead.

import type { SupabaseClient } from "@supabase/supabase-js"
import { activateOnApproval, flagWelcomeTask } from "../plan/service"
import { planLink } from "../plan/todo"
import { advanceIfPresent } from "../prospects/stages"
import { logProspectEvent } from "../prospects/history"
import { emitProspectEvent } from "../prospects/automation"
import { prospectLink } from "../tasks/links"
import { createTask } from "../tasks/service"
import { money, type SowDocument } from "./build"
import { canonical, getClientSow } from "./client"
import { firstNameOf } from "./model"
import { hashToken } from "./send"
import { createWorkspace, driveFallbackTask, type DriveApi } from "./workspace"
import { sendLetsGoEmail, type LetsGoEmail } from "../email/sendLetsGoEmail"

import { ACCEPT_NAME_MAX, ACCEPT_NAME_MIN } from "./accept-rules"

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

export type AcceptResult =
  | { ok: true; already: boolean; accepted_name: string; accepted_at: string; first_name: string; workspace_ready: boolean }
  | { ok: false; error: string; status: number }

type Row = { id: string; coach_client_id: string; engagement_id: string; status: string; sent_snapshot: SowDocument | null; accepted_at: string | null; accepted_name: string | null }

export async function acceptSow(
  db: SupabaseClient,
  token: unknown,
  name: unknown,
  opts: { drive?: DriveApi; rootId?: string | null; notify?: (to: string, e: LetsGoEmail) => Promise<unknown>; appUrl?: string } = {},
): Promise<AcceptResult> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return { ok: false, error: "This link is no longer active.", status: 404 }
  const typed = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : ""
  if (typed.length < ACCEPT_NAME_MIN) return { ok: false, error: "Please type your full name.", status: 400 }
  if (typed.length > ACCEPT_NAME_MAX) return { ok: false, error: "That name is too long.", status: 400 }

  const { data } = await db.from("client_sows")
    .select("id, coach_client_id, engagement_id, status, sent_snapshot, accepted_at, accepted_name").eq("token_hash", hashToken(token)).maybeSingle()
  const row = data as Row | null
  if (!row || (row.status !== "sent" && row.status !== "accepted")) return { ok: false, error: "This link is no longer active.", status: 404 }
  const already = (r: Row): AcceptResult => ({
    ok: true, already: true, accepted_name: r.accepted_name ?? "", accepted_at: r.accepted_at ?? "",
    first_name: firstNameOf(r.accepted_name), workspace_ready: true,
  })
  if (row.status === "accepted") return already(row)

  // Did the package change after the SOW went out? Read before approving.
  const current = await getClientSow(db, row.coach_client_id, row.engagement_id)
  const changedAfterSend = current.ok && !!row.sent_snapshot && canonical(current.data.document) !== canonical(row.sent_snapshot)

  // ── 1. Record it; only the first click counts ──
  const now = new Date().toISOString()
  const { data: won } = await db.from("client_sows").update({ status: "accepted", accepted_at: now, accepted_name: typed })
    .eq("id", row.id).eq("status", "sent").select("id")
  if (!won || !(won as unknown[]).length) {
    const { data: again } = await db.from("client_sows").select("id, coach_client_id, engagement_id, status, sent_snapshot, accepted_at, accepted_name").eq("id", row.id).maybeSingle()
    return again && (again as Row).status === "accepted" ? already(again as Row) : { ok: false, error: "This link is no longer active.", status: 404 }
  }

  const ccId = row.coach_client_id
  const { data: c } = await db.from("coach_clients").select("id, coach_profile_id, client_profile_id, name, lifecycle_status").eq("id", ccId).maybeSingle()
  const cc = c as { id: string; coach_profile_id: string; client_profile_id: string | null; name: string | null; lifecycle_status: string | null }
  const { data: e } = await db.from("coach_client_engagements").select("id, name, proposal_status").eq("id", row.engagement_id).maybeSingle()
  const eng = e as { id: string; name: string; proposal_status: string }
  const who = cc.name?.trim() || typed

  // ── 2. Approve the package ──
  if (eng.proposal_status !== "approved") {
    await db.from("coach_client_engagements").update({ proposal_status: "approved" }).eq("id", eng.id)
    await logProspectEvent(db, { coachClientId: ccId, eventType: "proposal_approved", actor: null, context: { name: eng.name, via: "lets_go" } })
    await activateOnApproval(db, ccId, eng.id)
  }

  // ── 3. Through SOW Executed to Onboarding ──
  if (cc.lifecycle_status === "Prospect") {
    await advanceIfPresent(db, { coachClientId: ccId, actingIds: [cc.coach_profile_id], stageKey: "sow_executed", actor: null })
    await advanceIfPresent(db, { coachClientId: ccId, actingIds: [cc.coach_profile_id], stageKey: "onboarding", actor: null })
  }

  // ── 4. The Drive workspace ──
  const ws = await createWorkspace(db, ccId, { drive: opts.drive, rootId: opts.rootId })
  if (!ws.ok) await driveFallbackTask(db, ccId, `Create Drive folder for ${who}`, ws.error)

  // ── 5. The welcome task ──
  const welcome = await flagWelcomeTask(db, ccId, eng.id)

  // ── 6. Send invoice ──
  const doc = row.sent_snapshot
  const terms = doc ? doc.payment.payments.map((p) => `- ${p.label}`).join("\n") : ""
  const invoice = await createTask(db, {
    title: `Send invoice to ${who}`,
    description: doc ? `${eng.name}: ${money(doc.payment.total_cents)}, as accepted on the SOW.\n${terms}` : eng.name,
    coach_client_id: ccId,
    client_profile_id: cc.client_profile_id,
    assignee_profile_id: cc.coach_profile_id,
    due_at: now,
    source: "auto",
    link: cc.lifecycle_status === "Prospect" ? prospectLink(ccId) : planLink({ coach_client_id: ccId, client_profile_id: cc.client_profile_id }),
  }, null)
  if (!invoice.ok) console.error("[sow/accept] invoice task failed:", invoice.error)

  // ── 7. History and the coach's email ──
  await logProspectEvent(db, {
    coachClientId: ccId, eventType: "sow_accepted", actor: null,
    context: { accepted_name: typed, name: eng.name, engagement_id: eng.id, changed_after_send: changedAfterSend },
  })
  const { data: coach } = await db.from("client_profiles").select("email").eq("id", cc.coach_profile_id).maybeSingle()
  const coachEmail = (coach as { email: string | null } | null)?.email?.trim()
  if (coachEmail) {
    const email: LetsGoEmail = {
      clientName: who, acceptedName: typed, packageName: eng.name,
      total: doc ? money(doc.payment.total_cents) : null, terms: doc ? doc.payment.payments.map((p) => p.label) : [],
      workspaceUrl: ws.ok ? ws.url : null, workspaceError: ws.ok ? null : ws.error,
      welcomeTask: welcome, changedAfterSend,
      link: `${(opts.appUrl ?? "").replace(/\/+$/, "")}${cc.lifecycle_status === "Prospect" ? prospectLink(ccId) : planLink({ coach_client_id: ccId, client_profile_id: cc.client_profile_id })}`,
    }
    const sent = await (opts.notify ?? sendLetsGoEmail)(coachEmail, email)
    if (sent && typeof sent === "object" && "ok" in sent && !(sent as { ok: boolean }).ok) console.error("[sow/accept] coach email failed:", (sent as { error?: string }).error)
  }

  // ── 8. End the follow-up ──
  await emitProspectEvent(db, "sow.accepted", ccId, { engagement_id: eng.id })

  return { ok: true, already: false, accepted_name: typed, accepted_at: now, first_name: firstNameOf(typed), workspace_ready: ws.ok }
}
