#!/usr/bin/env tsx
// Pretend to be Calendly, against the local dev server.
//
// Real bookings only reach production, so dev is tested with this: it sends a
// correctly signed booking, reschedule or cancellation to
// http://localhost:3000/api/webhooks/calendly, exactly as Calendly would, for
// the event type mapped in dev's calendly_event_type_actions (saved there by
// scripts/calendly-setup.ts). It can also make a prospect's waiting follow-up
// timer due now and run it.
//
// DEV ONLY: refuses any SUPABASE_URL but dev's. Credentials come from the
// environment; this file never reads a .env file.
//
// USAGE:
//   node --use-system-ca --env-file=.env.local --env-file=.env.development.local \
//     node_modules/tsx/dist/cli.mjs tests/calendly/simulate.ts <command> [options]
//
//   book       --email=<who books> [--name="First Last"] [--day=YYYY-MM-DD]
//              [--session="Mock Interview"]  a coaching session instead of the
//              consult: any session event type mapped in dev whose name
//              contains this text (scripts/calendly-setup.ts --sessions)
//   reschedule --email=<same email> [--day=YYYY-MM-DD]
//   cancel     --email=<same email> [--reason="text"]
//   timers     --email=<prospect's email>   fire their waiting follow-up now
//
// --day defaults to three days from today; the call is at 2 PM Eastern.

import { randomUUID } from "crypto"
import { createClient } from "@supabase/supabase-js"
import { SIGNATURE_HEADER, signCalendly, type CalendlyWebhook } from "../../lib/calendly/webhook"
import { drain } from "../../lib/automation/run"
import { fireDueTimers } from "../../lib/automation/timers"

const DEV_REF = "zydrqckpwidipwbhrfgd"
const BASE = process.env.SIMULATE_BASE_URL || "http://localhost:3000"
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

function need(name: string): string {
  const v = process.env[name]
  if (!v) { console.error(`${name} is not set.`); process.exit(1) }
  return v
}

const url = need("SUPABASE_URL")
if (!url.includes(DEV_REF)) { console.error("Refusing: SUPABASE_URL is not dev."); process.exit(1) }
const db = createClient(url, need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } })

/** 2 PM Eastern that day (an approximation of the offset is fine for a test). */
function startOf(day?: string): string {
  const d = day ?? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { console.error("--day must be YYYY-MM-DD"); process.exit(1) }
  return `${d}T18:00:00Z`
}

async function mappedType(session?: string): Promise<{ uri: string; name: string }> {
  let q = db.from("calendly_event_type_actions").select("event_type_uri, event_type_name")
    .eq("action", session ? "session_booked" : "consult_booked").eq("active", true)
  if (session) q = q.ilike("event_type_name", `%${session}%`)
  const { data } = await q.limit(1)
  const row = (data ?? [])[0]
  if (!row) {
    console.error(session
      ? `No session event type named like "${session}" is mapped in dev. Run scripts/calendly-setup.ts --sessions first.`
      : "No Calendly event type is mapped in dev. Run scripts/calendly-setup.ts first.")
    process.exit(1)
  }
  return { uri: row.event_type_uri, name: row.event_type_name ?? "Initial Consult" }
}

/** The latest booking SIGNAL saw from this email, for reschedule and cancel. */
async function lastBooking(email: string) {
  const { data } = await db.from("calendly_webhook_deliveries").select("payload, received_at")
    .eq("event", "invitee.created").eq("invitee_email", email.toLowerCase())
    .order("received_at", { ascending: false }).limit(1)
  const row = (data ?? [])[0]
  if (!row) { console.error(`No simulated booking for ${email} yet. Run "book" first.`); process.exit(1) }
  return row.payload as CalendlyWebhook
}

function newBooking(email: string, name: string, eventType: { uri: string; name: string }, start: string, oldInvitee: string | null): CalendlyWebhook {
  const ev = `https://api.calendly.com/scheduled_events/SIM-${randomUUID()}`
  return {
    event: "invitee.created",
    payload: {
      uri: `${ev}/invitees/SIM-${randomUUID()}`, email, name, rescheduled: false, old_invitee: oldInvitee,
      scheduled_event: { uri: ev, name: `${eventType.name} (simulated)`, start_time: start, event_type: eventType.uri },
    },
  }
}

async function send(body: CalendlyWebhook) {
  const raw = JSON.stringify(body)
  const res = await fetch(`${BASE}/api/webhooks/calendly`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [SIGNATURE_HEADER]: signCalendly(raw, need("CALENDLY_WEBHOOK_SIGNING_KEY"), Math.floor(Date.now() / 1000)) },
    body: raw,
  })
  const out = await res.json().catch(() => ({}))
  console.log(`  ${body.event}: HTTP ${res.status} -> ${out.outcome ?? ""}${out.detail ? ` (${out.detail})` : ""}`)
}

async function main() {
  const cmd = process.argv[2]
  const email = arg("email")
  if (!cmd || !email) { console.error("Usage: simulate.ts <book|reschedule|cancel|timers> --email=..."); process.exit(1) }

  if (cmd === "book") {
    await send(newBooking(email, arg("name") || email.split("@")[0], await mappedType(arg("session")), startOf(arg("day")), null))
  } else if (cmd === "reschedule") {
    const old = await lastBooking(email)
    // What Calendly sends: the old booking cancelled as a reschedule, then the new one.
    await send({ event: "invitee.canceled", payload: { ...old.payload, rescheduled: true } })
    const type = { uri: old.payload.scheduled_event.event_type, name: (old.payload.scheduled_event.name ?? "Session").replace(/ \(simulated\)$/, "") }
    await send(newBooking(email, old.payload.name ?? email, type, startOf(arg("day")), old.payload.uri))
  } else if (cmd === "cancel") {
    const old = await lastBooking(email)
    await send({ event: "invitee.canceled", payload: { ...old.payload, rescheduled: false,
      cancellation: { canceled_by: old.payload.name ?? email, reason: arg("reason") ?? "Simulated cancellation", canceler_type: "invitee" } } })
  } else if (cmd === "timers") {
    const { data: recs } = await db.from("coach_clients").select("id, name").ilike("invited_email", email)
    const ids = (recs ?? []).map((r) => r.id)
    if (!ids.length) { console.error(`No prospect with the email ${email}.`); process.exit(1) }
    // Clear any queue backlog first, so a waiting timer exists to make due.
    await drain(db)
    const { data: due, error } = await db.from("coach_automation_timers")
      .update({ fire_at: new Date().toISOString() })
      .in("coach_client_id", ids).is("fired_at", null).is("cancelled_at", null).select("id, fires_event_key")
    if (error) throw new Error(error.message)
    console.log(`  ${due?.length ?? 0} waiting timer(s) made due`)
    const fired = await fireDueTimers(db)
    const results = await drain(db)
    console.log(`  fired ${fired}; ${results.map((r) => `${r.outcome}${r.detail ? ` (${r.detail})` : ""}`).join("; ") || "nothing ran"}`)
  } else {
    console.error(`Unknown command ${cmd}`)
    process.exit(1)
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
