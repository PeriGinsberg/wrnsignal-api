// tests/automation/seed-networking-chain.ts
//
// The Networking campaign chain, as rows.
//
// Four templates and seven rules. No part of this chain is in application
// code, which is the test of whether the engine was worth building: a second
// chain is another run of a script like this one, not a deploy.
//
// Re-runnable. Templates are upserted on their key and rules are replaced for
// the event keys this chain owns, so editing a title here and re-running is
// the way to change the chain.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx tests/automation/seed-networking-chain.ts
//
// Credentials come from process.env; this file never reads a .env file.
// POINT IT AT DEV FIRST. It writes.

import { createClient } from "@supabase/supabase-js"

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
const db = createClient(url, key, { auth: { persistSession: false } })

const K = {
  create: "networking.create_campaign",
  review: "networking.review_campaign",
  build: "networking.upload_and_build",
  share: "networking.share_plan",
} as const

async function coachByEmail(email: string): Promise<string> {
  const { data, error } = await db.from("client_profiles")
    .select("id, name, is_coach").eq("email", email).maybeSingle()
  if (error) throw new Error(`${email}: ${error.message}`)
  if (!data) throw new Error(`No profile for ${email}`)
  if (!data.is_coach) throw new Error(`${email} is not a coach`)
  console.log(`  assignee ${email} -> ${data.name} (${data.id})`)
  return data.id as string
}

async function main() {
  console.log(`project: ${new URL(url!).hostname.split(".")[0]}\n`)

  // The two people the chain assigns to. Resolved by email rather than written
  // as ids, so this script is portable between dev and prod, where the same
  // person has different profile ids.
  const ERIN = await coachByEmail(process.env.CHAIN_BUILDER_EMAIL ?? "erin+coach@workforcereadynow.com")
  const PERI = await coachByEmail(process.env.CHAIN_REVIEWER_EMAIL ?? "peri@workforcereadynow.com")

  const templates = [
    {
      key: K.create,
      title: "Create Networking Campaign",
      description: "Build the target list and the outreach messages from the campaign brief.",
      default_assignee_profile_id: ERIN,
      due_offset_days: 1,
      decision_options: null,
      auto_complete_event: null,
    },
    {
      key: K.review,
      title: "Review Networking Campaign",
      description: "Approve the campaign, or send it back with a note saying what to change.",
      default_assignee_profile_id: PERI,
      due_offset_days: 1,
      // Completed by a decision rather than a tick. The UI shows Approve and
      // Request Changes in place of the checkbox, and the rules below branch
      // on which was pressed.
      decision_options: ["approve", "request_changes"],
      auto_complete_event: null,
    },
    {
      key: K.build,
      title: "Upload Campaign and Build Plan",
      description: "Upload the campaign workbook and generate the Networking Plan PDF.",
      default_assignee_profile_id: PERI,
      due_offset_days: 1,
      decision_options: null,
      // Ticks itself when the plan is generated for this campaign.
      auto_complete_event: "networking_plan.generated",
    },
    {
      key: K.share,
      title: "Share Plan with Client",
      description: "Share the plan with the client, which also emails them.",
      default_assignee_profile_id: PERI,
      due_offset_days: 1,
      decision_options: null,
      auto_complete_event: "networking_plan.shared",
    },
  ]

  console.log("\ntemplates:")
  const ids: Record<string, string> = {}
  for (const t of templates) {
    const { data, error } = await db.from("coach_task_templates")
      .upsert({ ...t, active: true, updated_at: new Date().toISOString() }, { onConflict: "key" })
      .select("id, key").single()
    if (error) throw new Error(`${t.key}: ${error.message}`)
    ids[t.key] = data.id
    console.log(`  ${t.key.padEnd(34)} ${data.id}`)
  }

  // Rules. Order within an event key is sort_order; across keys it does not
  // matter, because each fires on its own event.
  const rules = [
    // 1. A submitted brief starts the chain.
    { event_key: "campaign_brief.submitted", action: "create_task",
      template_id: ids[K.create], target_template_key: null, condition: {}, sort_order: 0 },

    // 2. Erin finishes building -> Peri reviews.
    { event_key: "task.completed", action: "create_task",
      template_id: ids[K.review], target_template_key: null,
      condition: { template_key: K.create }, sort_order: 0 },

    // 3. Approve -> build the plan.
    { event_key: "task.completed", action: "create_task",
      template_id: ids[K.build], target_template_key: null,
      condition: { template_key: K.review, decision: "approve" }, sort_order: 1 },

    // 4. Request Changes -> task one comes back, carrying the note.
    { event_key: "task.completed", action: "reopen_task",
      template_id: null, target_template_key: K.create,
      condition: { template_key: K.review, decision: "request_changes" }, sort_order: 2 },

    // 5. Plan built -> share it.
    { event_key: "task.completed", action: "create_task",
      template_id: ids[K.share], target_template_key: null,
      condition: { template_key: K.build }, sort_order: 3 },

    // 6 and 7. The two auto-completions. Both no-op when there is no open task,
    // which is the cutover case: clients already part-way through networking
    // have plans and no chain.
    { event_key: "networking_plan.generated", action: "complete_task",
      template_id: null, target_template_key: K.build, condition: {}, sort_order: 0 },
    { event_key: "networking_plan.shared", action: "complete_task",
      template_id: null, target_template_key: K.share, condition: {}, sort_order: 0 },
  ]

  // Replaced rather than upserted: a rule has no natural key, and leaving the
  // old set behind would double every create.
  const eventKeys = Array.from(new Set(rules.map((r) => r.event_key)))
  const { error: delErr } = await db.from("coach_automation_rules").delete().in("event_key", eventKeys)
  if (delErr) throw new Error(`clearing rules: ${delErr.message}`)

  const { error: insErr } = await db.from("coach_automation_rules")
    .insert(rules.map((r) => ({ ...r, active: true })))
  if (insErr) throw new Error(`inserting rules: ${insErr.message}`)

  console.log(`\nrules: ${rules.length} for event keys ${eventKeys.join(", ")}`)
  for (const r of rules) {
    const cond = Object.keys(r.condition).length ? JSON.stringify(r.condition) : "(any)"
    console.log(`  ${r.event_key.padEnd(26)} ${r.action.padEnd(14)} ${(r.target_template_key ?? "").padEnd(32)} ${cond}`)
  }
  console.log("\nSeeded.")
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
