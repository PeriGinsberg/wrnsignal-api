// tests/coach-delegate/rls-smoke.ts
//
// A DELEGATE COACH, PROVEN WITH REAL JWTS. A delegate works inside a principal's
// practice: she reaches the principal's clients, at the principal's level, with
// nothing of her own, and everything she writes carries HER id.
//
// The policies are the guard for anything the caller-JWT routes touch (workbooks,
// coach_clients, signal_interviews), so they are exercised here the way a browser
// holding the anon key would: sign in, then query.
//
// What this pins, in order:
//   1. Before delegation: the delegate reaches nothing of the principal's.
//   2. With delegation: she reaches every client of the PRINCIPAL, and still
//      NONE of any other coach's. That second half is the whole safety argument.
//   3. Writes stamp her own id, never the principal's.
//   4. Revoking the delegation cuts access off at once.
//
// DEV ONLY; refuses the prod project. Creates one workbook on a principal client
// and deletes it in a finally. Credentials from process.env only:
//   node --use-system-ca --env-file=.env.local node_modules/tsx/dist/cli.mjs tests/coach-delegate/rls-smoke.ts

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const PROD_REF = "ejhnokcnahauvrcbcmic"
const PRINCIPAL_EMAIL = process.env.PRINCIPAL_EMAIL || "peri+devcoach1@workforcereadynow.com"
const DELEGATE_EMAIL = process.env.DELEGATE_EMAIL || "erin@workforcereadynow.com"

const url = process.env.SUPABASE_URL || ""
const service = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
if (!url || !service || !anon) { console.error("need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and the anon key"); process.exit(1) }
if (url.includes(PROD_REF)) { console.error("Refusing to run against prod."); process.exit(1) }

let failures = 0
function ok(label: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ok    ${label}`)
  else { failures++; console.error(`  FAIL  ${label}`, detail ?? "") }
}

const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })

async function signIn(email: string): Promise<SupabaseClient> {
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email })
  if (link.error) throw new Error(`${email}: ${link.error.message}`)
  const pub = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const otp = await pub.auth.verifyOtp({ type: "magiclink", token_hash: link.data.properties.hashed_token })
  if (!otp.data.session) throw new Error(`${email}: ${otp.error?.message}`)
  return pub
}

const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`)
  return r.data
}

async function profileId(email: string): Promise<string> {
  const { data, error } = await admin.from("client_profiles").select("id").eq("email", email).maybeSingle()
  if (error || !data) throw new Error(`no profile for ${email}`)
  return data.id
}

async function main() {
  console.log(`Target: ${new URL(url).hostname.split(".")[0]}`)
  const [principalId, delegateId] = await Promise.all([profileId(PRINCIPAL_EMAIL), profileId(DELEGATE_EMAIL)])

  // The principal's clients, and one client of a DIFFERENT coach for the
  // negative case. Without an outsider this proves nothing.
  const principalLinks = must(await admin.from("coach_clients")
    .select("client_profile_id").eq("coach_profile_id", principalId).eq("status", "active")
    .not("client_profile_id", "is", null), "principal clients")
  const principalClientIds = principalLinks.map((r: any) => r.client_profile_id as string)
  if (!principalClientIds.length) throw new Error("the principal has no active clients to test with")

  const outsider = must(await admin.from("coach_clients")
    .select("client_profile_id, coach_profile_id").eq("status", "active")
    .not("client_profile_id", "is", null)
    .not("coach_profile_id", "in", `(${principalId},${delegateId})`), "other coaches' clients")
    .find((r: any) => !principalClientIds.includes(r.client_profile_id))
  if (!outsider) throw new Error("no client of another coach exists to test isolation against")
  const outsiderClientId = outsider.client_profile_id as string

  const delegateOwn = must(await admin.from("coach_clients").select("id")
    .eq("coach_profile_id", delegateId).eq("status", "active"), "delegate's own rows")
  console.log(`principal clients: ${principalClientIds.length} | outsider client: ${outsiderClientId} | delegate's own active rows: ${delegateOwn.length}`)

  const target = principalClientIds[0]
  const slug = `delegate-smoke-${Date.now()}`
  const content = { schema_version: 1, slug, client: { first_name: "T", full_name: "T C" }, interview: null,
    coach: { first_name: "P" }, sections: [], summary: { title: "t", eyebrow: "t", blocks: [] } }
  const ccId = must(await admin.from("coach_clients").select("id")
    .eq("coach_profile_id", principalId).eq("client_profile_id", target).maybeSingle(), "link")!.id
  const wb = must(await admin.from("workbooks").insert({
    coach_client_id: ccId, client_profile_id: target, slug, content, status: "with_client", created_by: principalId,
  }).select("id").single(), "create workbook")
  const W = wb.id as string

  // Start from no delegation, whatever the database currently says.
  await admin.from("coach_delegates").update({ status: "revoked" })
    .eq("principal_coach_profile_id", principalId).eq("delegate_coach_profile_id", delegateId)

  try {
    const D = await signIn(DELEGATE_EMAIL)

    console.log("\nbefore delegation")
    // Her OWN rows stay visible whatever their status (that is the policy's
    // second clause, and it is how a coach sees a client who revoked them), so
    // the question is only ever whether the PRINCIPAL's rows are reachable.
    ok("delegate sees none of the principal's own links",
      must(await D.from("coach_clients").select("id").eq("coach_profile_id", principalId), "links").length === 0)
    ok("delegate cannot read the principal's workbook",
      must(await D.from("workbooks").select("id").eq("id", W), "workbooks").length === 0)

    await admin.from("coach_delegates").upsert({
      principal_coach_profile_id: principalId, delegate_coach_profile_id: delegateId, status: "active",
    }, { onConflict: "principal_coach_profile_id,delegate_coach_profile_id" })
    const D2 = await signIn(DELEGATE_EMAIL) // fresh token, same policies

    console.log("\nwith delegation")
    const seen = must(await D2.from("coach_clients").select("client_profile_id, coach_profile_id")
      .eq("coach_profile_id", principalId), "links after")
    // Containment, not equality: the policy has no status filter, so she also
    // sees the principal's revoked rows and prospects. What matters is that
    // every ACTIVE client of the principal is reachable.
    const seenIds = new Set(seen.map((r: any) => r.client_profile_id as string))
    ok("delegate reaches every active client of the principal",
      principalClientIds.every((id) => seenIds.has(id)),
      `${principalClientIds.filter((id) => !seenIds.has(id)).length} missing of ${principalClientIds.length}`)
    ok("delegate reads the principal's workbook",
      must(await D2.from("workbooks").select("id").eq("id", W), "workbooks").length === 1)
    ok("delegate reads that client's interviews",
      !(await D2.from("signal_interviews").select("id").eq("profile_id", target)).error)

    console.log("\nisolation from every other coach")
    ok("delegate sees no link of another coach's client",
      must(await D2.from("coach_clients").select("id").eq("client_profile_id", outsiderClientId), "outsider links").length === 0)
    ok("delegate reads no workbook of another coach's client",
      must(await D2.from("workbooks").select("id").eq("client_profile_id", outsiderClientId), "outsider workbooks").length === 0)
    ok("delegate reads no interviews of another coach's client",
      must(await D2.from("signal_interviews").select("id").eq("profile_id", outsiderClientId), "outsider interviews").length === 0)
    const everything = must(await D2.from("coach_clients").select("coach_profile_id"), "all visible links")
    const coaches = new Set(everything.map((r: any) => r.coach_profile_id as string))
    ok("every link she can see belongs to her or the principal",
      [...coaches].every((c) => c === principalId || c === delegateId), [...coaches])

    console.log("\nattribution")
    const comment = must(await D2.from("workbook_comments").insert({
      workbook_id: W, section_id: "_general", kind: "coach_comment", body: "from the delegate",
      author_role: "coach", author_id: delegateId,
    }).select("id, author_id").single(), "delegate comment")
    ok("her write carries her own id, not the principal's", comment.author_id === delegateId)
    ok("she cannot write as the principal",
      !!(await D2.from("workbook_comments").insert({
        workbook_id: W, section_id: "_general", kind: "coach_comment", body: "spoofed",
        author_role: "coach", author_id: principalId,
      })).error)

    console.log("\ncoach_clients stays read-only for her")
    ok("she cannot revoke the principal's row",
      ((await D2.from("coach_clients").update({ status: "revoked" })
        .eq("coach_profile_id", principalId).eq("client_profile_id", target).select("id")).data ?? []).length === 0)
    ok("she cannot grant herself a delegation",
      !!(await D2.from("coach_delegates").insert({
        principal_coach_profile_id: principalId, delegate_coach_profile_id: delegateId,
      })).error)

    console.log("\nthe practice's shared library (Stage 2)")
    // The routes read these with the service role, so what matters here is the
    // DATA shape those widened reads depend on: anything the delegate creates
    // must belong to the principal, or the principal never sees it. Route
    // behaviour itself is covered by the staging pass.
    {
      const { data: pkgs } = await admin.from("coach_packages").select("coach_profile_id")
        .in("coach_profile_id", [principalId, delegateId])
      const { data: cats } = await admin.from("coach_document_categories").select("coach_profile_id")
        .in("coach_profile_id", [principalId, delegateId])
      const { data: stages } = await admin.from("coach_pipeline_stages").select("coach_profile_id")
        .in("coach_profile_id", [principalId, delegateId])
      const all = [...(pkgs ?? []), ...(cats ?? []), ...(stages ?? [])]
      const ownedByDelegate = all.filter((r: any) => r.coach_profile_id === delegateId).length
      console.log(`  (packages ${pkgs?.length ?? 0}, categories ${cats?.length ?? 0}, stages ${stages?.length ?? 0}; ${ownedByDelegate} owned by the delegate)`)
      ok("the delegate owns no library rows of her own", ownedByDelegate === 0, ownedByDelegate)
    }
    {
      // A calendar is personal: it is the one thing deliberately NOT widened, so
      // the delegate must not reach the principal's connection.
      const { data: principalCal } = await admin.from("coach_calendar_connections")
        .select("id").eq("coach_profile_id", principalId)
      if (!(principalCal ?? []).length) {
        console.log("  (skipped: the principal has no calendar connection to test against)")
      } else {
        const seen = await D2.from("coach_calendar_connections").select("id").eq("coach_profile_id", principalId)
        ok("the delegate cannot read the principal's calendar", (seen.data ?? []).length === 0, seen.data)
      }
    }

    console.log("\nrevoking the delegation")
    await admin.from("coach_delegates").update({ status: "revoked" })
      .eq("principal_coach_profile_id", principalId).eq("delegate_coach_profile_id", delegateId)
    const D3 = await signIn(DELEGATE_EMAIL)
    ok("access stops at once",
      must(await D3.from("coach_clients").select("id").eq("coach_profile_id", principalId), "after revoke").length === 0)
    ok("the workbook is out of reach again",
      must(await D3.from("workbooks").select("id").eq("id", W), "after revoke").length === 0)
  } finally {
    await admin.from("workbooks").delete().eq("id", W)
    await admin.from("coach_delegates").update({ status: "active" })
      .eq("principal_coach_profile_id", principalId).eq("delegate_coach_profile_id", delegateId)
  }

  if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
  console.log("\nall passed (smoke workbook removed, delegation left active)")
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
