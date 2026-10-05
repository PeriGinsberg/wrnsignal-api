// lib/sow/client.ts
//
// One client's SOW on the server: gather everything the SOW is built from,
// and save the coach's settings for it (opening paragraph, price for this
// client, payment terms). The build rules are in ./build.ts.
//
// Amounts here are in CENTS, both ways. The SOW is one surface with its own
// money (prices, payments), and one unit end to end keeps a split from being
// off by a rounding.

import type { SupabaseClient } from "@supabase/supabase-js"
import { checkPayment, composeSow, defaultPaymentFor, money, type DefaultPayment, type SowDocument, type SowPayment } from "./build"
import { SOW_OPENING_MAX, fillOpening, normalizeText } from "./model"
import { getSowLines } from "./service"

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number }
const fail = (error: string, status = 400): { ok: false; error: string; status: number } => ({ ok: false, error, status })

export type ClientSow = {
  engagement_id: string
  proposal_status: string
  status: "draft" | "sent" | "accepted"
  saved: boolean
  opening: string | null
  price_override_cents: number | null
  package_total_cents: number
  total_cents: number
  payment: SowPayment
  document: SowDocument
  warnings: string[]
}

type Deliv = { id: string; name: string; phase_id: string | null; not_needed: boolean; sort_order: number; fee_cents: number | null; source_milestone_id: string | null }

/** The package's price: included deliverables' fees, less the discount (never below $0). */
export function packageTotalCents(delivs: { fee_cents: number | null; not_needed?: boolean }[], discountCents: number | null): number {
  const subtotal = delivs.filter((d) => !d.not_needed).reduce((s, d) => s + (d.fee_cents ?? 0), 0)
  return subtotal - Math.min(discountCents ?? 0, subtotal)
}

async function load(db: SupabaseClient, coachClientId: string, engagementId: string) {
  const { data: e } = await db.from("coach_client_engagements")
    .select("id, coach_client_id, name, discount_cents, source_package_id, proposal_status").eq("id", engagementId).maybeSingle()
  const eng = e as { id: string; coach_client_id: string; name: string; discount_cents: number | null; source_package_id: string | null; proposal_status: string } | null
  if (!eng || eng.coach_client_id !== coachClientId) return null
  const { data: c } = await db.from("coach_clients").select("id, coach_profile_id, name, client_profile_id").eq("id", coachClientId).maybeSingle()
  const cc = c as { id: string; coach_profile_id: string; name: string | null; client_profile_id: string | null } | null
  if (!cc) return null
  const { data: ds, error } = await db.from("coach_client_engagement_deliverables")
    .select("id, name, phase_id, not_needed, sort_order, fee_cents, source_milestone_id").eq("engagement_id", engagementId)
  if (error) throw new Error(`Failed to read the package: ${error.message}`)
  const delivs = (ds ?? []) as Deliv[]
  const sourceIds = delivs.map((d) => d.source_milestone_id).filter((id): id is string => !!id)
  const { data: ms } = sourceIds.length
    ? await db.from("coach_milestones").select("id, sow_bullets").in("id", sourceIds)
    : { data: [] }
  const bullets = new Map(((ms ?? []) as { id: string; sow_bullets: string | null }[]).map((m) => [m.id, m.sow_bullets]))
  const { data: ph } = await db.from("coach_phases").select("id, label, sow_subtitle, sow_note, sort_order").eq("coach_profile_id", cc.coach_profile_id)
  const lines = await getSowLines(db, cc.coach_profile_id)
  const { data: coach } = await db.from("client_profiles").select("coach_org").eq("id", cc.coach_profile_id).maybeSingle()
  let clientName = cc.name?.trim() || null
  if (!clientName && cc.client_profile_id) {
    const { data: p } = await db.from("client_profiles").select("name").eq("id", cc.client_profile_id).maybeSingle()
    clientName = (p as { name: string | null } | null)?.name?.trim() || null
  }
  let pkgDefault: DefaultPayment = null
  if (eng.source_package_id) {
    const { data: pk } = await db.from("coach_packages").select("default_payment").eq("id", eng.source_package_id).maybeSingle()
    pkgDefault = ((pk as { default_payment: DefaultPayment } | null)?.default_payment) ?? null
  }
  const { data: row } = await db.from("client_sows").select("*").eq("engagement_id", engagementId).maybeSingle()
  // A new SOW starts from the coach's default opening, [First Name] filled in.
  let defaultOpening: string | null = null
  if (!row) {
    const { data: st } = await db.from("coach_sow_settings").select("default_opening").eq("coach_profile_id", cc.coach_profile_id).maybeSingle()
    defaultOpening = fillOpening((st as { default_opening: string | null } | null)?.default_opening, clientName)
  }
  return {
    defaultOpening,
    eng, cc, delivs, bullets, lines, pkgDefault, clientName: clientName ?? "this client",
    phases: (ph ?? []) as { id: string; label: string; sow_subtitle: string | null; sow_note: string | null; sort_order: number }[],
    practiceName: ((coach as { coach_org: string | null } | null)?.coach_org) ?? null,
    row: row as { id: string; status: "draft" | "sent" | "accepted"; opening: string | null; price_override_cents: number | null; payment: SowPayment } | null,
  }
}

/** The client's SOW for one package: settings (saved, or the defaults) and the built document. */
export async function getClientSow(db: SupabaseClient, coachClientId: string, engagementId: string): Promise<Result<ClientSow>> {
  const x = await load(db, coachClientId, engagementId)
  if (!x) return fail("Package not found", 404)
  const packageTotal = packageTotalCents(x.delivs, x.eng.discount_cents)
  const total = x.row?.price_override_cents ?? packageTotal
  const payment = x.row?.payment ?? defaultPaymentFor(x.pkgDefault, total)
  // Saved: the coach's own text, even if they cleared it. Unsaved: the default.
  const opening = x.row ? x.row.opening : x.defaultOpening

  const included = x.delivs.filter((d) => !d.not_needed)
  const warnings: string[] = []
  const unpriced = included.filter((d) => d.fee_cents === null).map((d) => d.name)
  if (unpriced.length && x.row?.price_override_cents == null) warnings.push(`No fee set for ${unpriced.join(", ")}, so the package total may be low.`)
  const bare = included.filter((d) => !(d.source_milestone_id && x.bullets.get(d.source_milestone_id))).map((d) => d.name)
  if (bare.length) warnings.push(`No SOW bullets for ${bare.join(", ")}. Add them in Settings > Services > Deliverables.`)
  const check = checkPayment(payment, total)
  if (!check.ok) warnings.push(check.error)
  if (!included.length) warnings.push("Every deliverable is Not needed, so the SOW has no stages.")

  const document = composeSow({
    clientName: x.clientName,
    practiceName: x.practiceName,
    packageName: x.eng.name,
    opening,
    phases: x.phases,
    deliverables: x.delivs.map((d) => ({
      name: d.name, phase_id: d.phase_id, not_needed: d.not_needed, sort_order: d.sort_order,
      bullets: d.source_milestone_id ? x.bullets.get(d.source_milestone_id) ?? null : null,
    })),
    lines: x.lines,
    totalCents: total,
    payment,
  })

  return {
    ok: true,
    data: {
      engagement_id: engagementId,
      proposal_status: x.eng.proposal_status,
      status: x.row?.status ?? "draft",
      saved: !!x.row,
      opening,
      price_override_cents: x.row?.price_override_cents ?? null,
      package_total_cents: packageTotal,
      total_cents: total,
      payment,
      document,
      warnings,
    },
  }
}

/**
 * Save the coach's settings for this client's SOW. Only while the package is a
 * proposal (draft or sent) and the SOW itself has not gone out; Step 3 decides
 * what editing a sent SOW means.
 */
export async function saveClientSow(
  db: SupabaseClient,
  args: { coachClientId: string; engagementId: string; input: unknown; actor: string },
): Promise<Result<ClientSow>> {
  const x = await load(db, args.coachClientId, args.engagementId)
  if (!x) return fail("Package not found", 404)
  if (x.eng.proposal_status === "approved" || x.eng.proposal_status === "declined") {
    return fail(`This package is ${x.eng.proposal_status}; its SOW can't be changed.`, 409)
  }
  if (x.row && x.row.status !== "draft") return fail("This SOW has been sent. Changing it comes with re-sending.", 409)

  const b = (args.input ?? {}) as Record<string, unknown>
  const opening = normalizeText(b.opening, SOW_OPENING_MAX, "The opening paragraph")
  if ("error" in opening) return fail(opening.error)
  let override: number | null = null
  if (b.price_override_cents !== null && b.price_override_cents !== undefined) {
    const v = b.price_override_cents
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return fail("The price for this client must be $0 or more.")
    override = v
  }
  const total = override ?? packageTotalCents(x.delivs, x.eng.discount_cents)
  const payment = checkPayment(b.payment, total)
  if (!payment.ok) return fail(payment.error)

  const values = { opening: opening.value, price_override_cents: override, payment: payment.value, updated_by: args.actor }
  const { error } = x.row
    ? await db.from("client_sows").update(values).eq("id", x.row.id)
    : await db.from("client_sows").insert({ coach_client_id: args.coachClientId, engagement_id: args.engagementId, status: "draft", ...values })
  if (error) return fail(`Failed to save the SOW: ${error.message}`, 500)
  return getClientSow(db, args.coachClientId, args.engagementId)
}

export { money }
