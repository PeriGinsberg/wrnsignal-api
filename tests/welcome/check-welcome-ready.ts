#!/usr/bin/env tsx
// READ-ONLY. Every client whose plan has a welcome task, and whether the
// welcome email can go out for them: the task still waiting (not released),
// its open To-Do item, the Drive workspace link, the email and parent email,
// which template their plan matches, and whether that template is loaded with
// a scheduling link. Writes nothing.
//
// USAGE:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... NODE_OPTIONS=--use-system-ca \
//   npx tsx tests/welcome/check-welcome-ready.ts [--name "First Last"]
// Against prod, also set ALLOW_PROD=yes (it still only reads).
//
// Creds come from process.env only; this file never reads .env*.

import { createClient } from "@supabase/supabase-js"
import { WELCOME_START_LABEL, startForPhase } from "../../lib/welcome/model"

const PROD_REF = "ejhnokcnahauvrcbcmic" // DEVELOPMENT.md, "The mental model"

function req(name: string, alt?: string): string {
  const v = process.env[name] || (alt ? process.env[alt] : undefined)
  if (!v) { console.error(`Missing ${name}`); process.exit(2) }
  return v
}
const arg = (flag: string) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : undefined }

async function main() {
  const url = req("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL")
  const ref = new URL(url).hostname.split(".")[0]
  if (ref === PROD_REF && process.env.ALLOW_PROD !== "yes") {
    console.error("This is PROD. Set ALLOW_PROD=yes to run against it (this script only reads).")
    process.exit(2)
  }
  const db = createClient(url, req("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } })
  const nameFilter = arg("--name")?.trim().toLowerCase()
  console.log(`Project: ${ref}${ref === PROD_REF ? " (PROD)" : ""}   read-only\n`)

  const { data: tasks, error } = await db.from("coach_client_engagement_activities")
    .select("id, name, owner, state, released_at, engagement_deliverable_id").eq("welcome_release", true)
  if (error) throw new Error(`activities: ${error.message}`)
  if (!tasks?.length) { console.log("No welcome tasks anywhere."); return }

  const templates = await db.from("coach_welcome_templates").select("coach_profile_id, start_key, scheduling_link")
  const tableMissing = !!templates.error
  if (tableMissing) console.log(`Welcome templates table: NOT PRESENT (${templates.error!.message}). Migration 20261013 has not run here.\n`)

  for (const t of tasks as { id: string; name: string; owner: string; state: string; released_at: string | null; engagement_deliverable_id: string }[]) {
    const { data: d } = await db.from("coach_client_engagement_deliverables").select("name, engagement_id, phase_id").eq("id", t.engagement_deliverable_id).maybeSingle()
    const deliv = d as { name: string; engagement_id: string; phase_id: string | null } | null
    const { data: e } = deliv ? await db.from("coach_client_engagements").select("name, coach_client_id, proposal_status").eq("id", deliv.engagement_id).maybeSingle() : { data: null }
    const eng = e as { name: string; coach_client_id: string; proposal_status: string } | null
    if (!eng) { console.log(`Task ${t.id}: no package found`); continue }
    const { data: c } = await db.from("coach_clients")
      .select("id, name, coach_profile_id, client_profile_id, invited_email, parent_email, workspace_folder_url, lifecycle_status").eq("id", eng.coach_client_id).maybeSingle()
    const cc = c as { id: string; name: string | null; coach_profile_id: string; client_profile_id: string | null; invited_email: string | null; parent_email: string | null; workspace_folder_url: string | null; lifecycle_status: string | null } | null
    if (!cc) continue
    if (nameFilter && !(cc.name ?? "").toLowerCase().includes(nameFilter)) continue
    let email = cc.invited_email
    if (!email && cc.client_profile_id) {
      const { data: p } = await db.from("client_profiles").select("email").eq("id", cc.client_profile_id).maybeSingle()
      email = (p as { email: string | null } | null)?.email ?? null
    }
    let phase: { phase_key: string; label: string } | null = null
    if (deliv?.phase_id) {
      const { data: p } = await db.from("coach_phases").select("phase_key, label").eq("id", deliv.phase_id).maybeSingle()
      phase = p as { phase_key: string; label: string } | null
    }
    const match = startForPhase(phase?.phase_key)
    const tpl = tableMissing ? null : ((templates.data ?? []) as { coach_profile_id: string; start_key: string; scheduling_link: string | null }[])
      .find((x) => x.coach_profile_id === cc.coach_profile_id && x.start_key === match)
    const { data: todos } = await db.from("coach_tasks").select("title, status").eq("plan_activity_id", t.id).is("deleted_at", null)
    const open = ((todos ?? []) as { title: string; status: string }[]).filter((x) => x.status === "open")
    const waiting = t.state === "active" || t.state === "upcoming"

    console.log(`${cc.name ?? "(no name)"}   [${cc.lifecycle_status ?? "?"}]   relationship ${cc.id}`)
    console.log(`  package:        ${eng.name} (${eng.proposal_status})`)
    console.log(`  welcome task:   "${t.name}" in ${deliv?.name ?? "?"}, state ${t.state}${t.released_at ? `, released ${t.released_at}` : ""}`)
    console.log(`  To-Do item:     ${open.length ? `open: "${open[0].title}"` : "none open"}`)
    console.log(`  email:          ${email ?? "MISSING"}`)
    console.log(`  parent email:   ${cc.parent_email ?? "none"}`)
    console.log(`  Drive link:     ${cc.workspace_folder_url ?? "MISSING"}`)
    console.log(`  phase:          ${phase?.label ?? "none"}  ->  template ${match ? WELCOME_START_LABEL[match] : "none (the coach picks)"}`)
    if (!tableMissing) console.log(`  template:       ${!match ? "n/a" : !tpl ? "NOT LOADED for this coach" : tpl.scheduling_link ? `loaded, link ${tpl.scheduling_link}` : "loaded, NO scheduling link"}`)
    console.log(`  verdict:        ${!waiting ? "ALREADY RELEASED: the editor will not open for this client" : !cc.workspace_folder_url ? "waiting, but no Drive link yet" : !email ? "waiting, but no email" : "ready: still waiting for the welcome email"}\n`)
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
