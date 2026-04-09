// lib/jobfit-family-inference.ts
//
// Single source of truth for mapping a candidate's target roles (free text)
// to one or more JobFamily values. This file replaces three previously
// separate implementations:
//
//   - app/api/profile-intake/route.ts:inferTargetFamilies
//   - app/api/_lib/jobfitProfileAdapter.ts:inferTargetFamilies
//   - app/api/jobfit/extract.ts:inferTargetFamiliesFromTags (which is
//     a related but different mechanism — tag-based inference from
//     job requirement units — and continues to live in extract.ts)
//
// The three string-based copies had drifted out of sync three times in
// rapid iteration (Lily Stein Engineering, Josselyn Chavez Consulting,
// Ryan Rudnet Finance). Consolidating into one function eliminates the
// drift class entirely.
//
// Design notes:
//   - Accepts the target-roles free-text string AND optional profile text
//     so the same function can be called from profile-intake (where
//     targetRoles is the primary signal) and from the adapter (where
//     we have both the profile text and parsed targetRoles).
//   - Returns JobFamily[] (plural) because candidates frequently target
//     cross-functional roles (e.g. Strategy Consulting + Business Ops).
//   - Order within the returned array reflects match priority, but
//     callers should treat the array as a set.
//   - When targetRoles is empty, falls back to scanning profileText for
//     strong family signals. If both are empty, returns ["Other"].

import type { JobFamily } from "@/app/api/jobfit/signals"

function lower(s: string | null | undefined): string {
  return String(s ?? "").toLowerCase()
}

/**
 * Infer the set of JobFamily values a candidate is targeting based on
 * their stated target roles and (optionally) their full profile text.
 *
 * @param targetRoles The candidate's target roles as free text. Can be
 *   a comma/newline-separated list or a single string. May be empty.
 * @param profileText Optional full profile text (resume + intake fields)
 *   used as a fallback when targetRoles is empty.
 *
 * @returns Array of JobFamily values matched. Always returns at least
 *   one value — uses ["Other"] as a final fallback.
 */
export function inferTargetFamilies(
  targetRoles: string | null | undefined,
  profileText?: string | null
): JobFamily[] {
  const roles = lower(targetRoles)
  const text = lower(profileText)

  const out: JobFamily[] = []

  // ── Sales ──────────────────────────────────────────────────────────────
  if (
    roles.includes("sales") ||
    roles.includes("business development") ||
    roles.includes("account executive") ||
    roles.includes("account manager") ||
    roles.includes("clinical sales") ||
    roles.includes("medical sales") ||
    roles.includes("orthopedic sales") ||
    roles.includes("trauma sales") ||
    roles.includes("spinal sales") ||
    roles.includes("prosthetic sales") ||
    roles.includes("prostetic sales") || // preserve known typo in intake data
    roles.includes("associate sales representative") ||
    roles.includes("sales representative") ||
    roles.includes("pharmaceutical sales")
  ) {
    out.push("Sales")
  }

  // ── PreMed ─────────────────────────────────────────────────────────────
  if (
    roles.includes("premed") ||
    roles.includes("pre-med") ||
    roles.includes("pre med") ||
    roles.includes("physician shadow") ||
    roles.includes("clinical research") ||
    roles.includes("medical assistant") ||
    roles.includes("emt") ||
    roles.includes("scribe")
  ) {
    out.push("PreMed")
  }

  // ── Healthcare (nurse, RN, LPN, tech) ──────────────────────────────────
  if (
    roles.includes("nurse") ||
    roles.includes("nursing") ||
    roles.includes("rn ") ||
    roles.includes(" rn") ||
    roles.includes("lpn") ||
    roles.includes("physician assistant") ||
    roles.includes("nurse practitioner") ||
    roles.includes("respiratory therapist") ||
    roles.includes("physical therapist") ||
    roles.includes("occupational therapist") ||
    roles.includes("pharmacist") ||
    roles.includes("healthcare")
  ) {
    out.push("Healthcare")
  }

  // ── Consulting (incl. Strategy, CoS, Business Ops, HRBP) ───────────────
  // Covers strategy, business operations, chief of staff, and HR business
  // partner roles because the scoring engine currently has no dedicated
  // Operations or HR family. These roles all sit in the same
  // "cross-functional strategic operator" space as management consulting.
  //
  // Matches both "consulting" and "consultant" because candidates phrase
  // it both ways (Strategy Consulting vs Strategy Consultant). Requires
  // "strategy" to be compound (strategy AND operations / consulting /
  // business strategy) to avoid false positives on "product strategy",
  // "growth strategy", and "marketing strategy" which are actually
  // Marketing roles.
  const targetsHR =
    roles.includes("people operations") ||
    roles.includes("people ops") ||
    roles.includes("hrbp") ||
    roles.includes("hr business partner") ||
    roles.includes("people partner") ||
    /\bhuman resources\b/.test(roles) ||
    /\bhr (director|manager|generalist|lead|leader)\b/.test(roles)

  if (
    roles.includes("consulting") ||
    roles.includes("consultant") ||
    roles.includes("management consult") ||
    roles.includes("strategy consult") ||
    roles.includes("strategy and operations") ||
    roles.includes("strategy & operations") ||
    roles.includes("strategic operations") ||
    roles.includes("strategy and business operations") ||
    roles.includes("business strategy") ||
    roles.includes("corporate strategy") ||
    roles.includes("chief of staff") ||
    /\bcos\b/.test(roles) ||
    roles.includes("business operations") ||
    roles.includes("business ops") ||
    roles.includes("operations manager") ||
    roles.includes("operations director") ||
    roles.includes("director of operations") ||
    roles.includes("head of operations") ||
    roles.includes("internal operations") ||
    targetsHR
  ) {
    out.push("Consulting")
  }

  // HR-targeting candidates also need "Other" in their target families,
  // because the scoring engine has no dedicated HR family and routes all
  // HR/people-leader jobs to "Other" (via jobTitleIsHR in extract.ts).
  // Without this, a candidate targeting HRBP who applies to a Director of
  // Human Resources posting would trigger RISK_FAMILY_MISMATCH against
  // their own stated target. This is purely additive — Consulting is
  // still pushed above so strategy/CoS roles continue to match.
  if (targetsHR) {
    out.push("Other")
  }

  // ── Marketing ──────────────────────────────────────────────────────────
  if (
    roles.includes("marketing") ||
    roles.includes("brand") ||
    roles.includes("communications") ||
    roles.includes(" pr ") ||
    roles.endsWith(" pr") ||
    roles.startsWith("pr ") ||
    roles.includes("content") ||
    roles.includes("social media") ||
    roles.includes("growth") ||
    roles.includes("ecommerce") ||
    roles.includes("public relations")
  ) {
    out.push("Marketing")
  }

  // ── Finance (explicit finance track) ───────────────────────────────────
  // Single unified check. The adapter previously had two Finance blocks
  // that duplicated each other; consolidated here. Does NOT include
  // "accounting" — that's a separate family.
  if (
    roles.includes("finance") ||
    roles.includes("financial analyst") ||
    roles.includes("financial advisor") ||
    roles.includes("financial planner") ||
    roles.includes("financial consultant") ||
    roles.includes("financial professional") ||
    roles.includes("investment banking") ||
    roles.includes("investment analyst") ||
    roles.includes("investment associate") ||
    roles.includes("wealth management") ||
    roles.includes("wealth advisor") ||
    roles.includes("private equity") ||
    roles.includes("venture capital") ||
    roles.includes("asset management") ||
    roles.includes("portfolio management") ||
    roles.includes("portfolio analyst") ||
    roles.includes("commercial real estate") ||
    roles.includes("client associate") || // wealth mgmt support
    roles.includes("registered client associate")
  ) {
    out.push("Finance")
  }

  // ── Accounting ─────────────────────────────────────────────────────────
  if (
    roles.includes("accounting") ||
    roles.includes("accountant") ||
    roles.includes("audit") ||
    roles.includes("tax") ||
    roles.includes("assurance") ||
    roles.includes("cpa")
  ) {
    out.push("Accounting")
  }

  // ── Analytics ──────────────────────────────────────────────────────────
  if (
    roles.includes("data analyst") ||
    roles.includes("data analytics") ||
    roles.includes("business intelligence") ||
    roles.includes(" bi ") ||
    roles.includes("tableau") ||
    roles.includes("power bi") ||
    roles.includes("sql analyst") ||
    roles.includes("analytics")
  ) {
    out.push("Analytics")
  }

  // ── Government ─────────────────────────────────────────────────────────
  if (
    roles.includes("government") ||
    roles.includes("public policy") ||
    roles.includes("government affairs") ||
    roles.includes("legislative") ||
    roles.includes("public sector") ||
    roles.includes("federal") ||
    roles.includes("city hall") ||
    roles.includes("policy analyst")
  ) {
    out.push("Government")
  }

  // ── Legal ──────────────────────────────────────────────────────────────
  if (
    roles.includes("lawyer") ||
    roles.includes("attorney") ||
    roles.includes("paralegal") ||
    roles.includes("legal assistant") ||
    roles.includes("legal intern") ||
    roles.includes("legal research") ||
    roles.includes("law firm") ||
    roles.includes("pre-law") ||
    roles.includes("prelaw") ||
    roles.includes("jd ") ||
    roles.endsWith(" jd")
  ) {
    out.push("Legal")
  }

  // ── IT / Software ──────────────────────────────────────────────────────
  if (
    roles.includes("software engineer") ||
    roles.includes("software developer") ||
    roles.includes("front end developer") ||
    roles.includes("frontend developer") ||
    roles.includes("back end developer") ||
    roles.includes("backend developer") ||
    roles.includes("full stack") ||
    roles.includes("fullstack") ||
    roles.includes("web developer") ||
    roles.includes("mobile developer") ||
    roles.includes("devops") ||
    roles.includes("site reliability") ||
    roles.includes("sre") ||
    roles.includes("software development") ||
    roles.includes("swe") ||
    roles.includes("data engineer") ||
    roles.includes("machine learning engineer") ||
    roles.includes("ml engineer")
  ) {
    out.push("IT_Software")
  }

  // ── Engineering (non-software) ─────────────────────────────────────────
  if (
    roles.includes("mechanical engineer") ||
    roles.includes("electrical engineer") ||
    roles.includes("civil engineer") ||
    roles.includes("chemical engineer") ||
    roles.includes("biomedical engineer") ||
    roles.includes("biomedical engineering") ||
    roles.includes("bioengineer") ||
    roles.includes("bioengineering") ||
    roles.includes("industrial engineer") ||
    roles.includes("structural engineer") ||
    roles.includes("manufacturing engineer") ||
    roles.includes("environmental engineer") ||
    roles.includes("aerospace engineer") ||
    roles.includes("medical device")
  ) {
    out.push("Engineering")
  }

  // ── Trades ─────────────────────────────────────────────────────────────
  if (
    roles.includes("electrician") ||
    roles.includes("plumber") ||
    roles.includes("welder") ||
    roles.includes("hvac") ||
    roles.includes("carpenter") ||
    roles.includes("machinist") ||
    roles.includes("cnc operator") ||
    roles.includes("pipefitter") ||
    roles.includes("millwright") ||
    roles.includes("sheet metal") ||
    roles.includes("apprentice")
  ) {
    out.push("Trades")
  }

  // ── Fallback: scan profile text if target roles produced nothing ───────
  // Only fires when targetRoles is empty AND profileText is available.
  // Avoids being the primary inference path (target roles are more reliable
  // than resume text for stated intent).
  if (out.length === 0 && !roles && text) {
    if (text.includes("sales") || text.includes("business development")) out.push("Sales")
    if (text.includes("clinical") || text.includes("patient") || text.includes("medical device")) out.push("PreMed")
    if (text.includes("consulting") || text.includes("management consulting") || text.includes("chief of staff")) out.push("Consulting")
    if (text.includes("marketing") || text.includes("brand manager")) out.push("Marketing")
    if (text.includes("investment banking") || text.includes("wealth management")) out.push("Finance")
    if (text.includes("accountant") || text.includes("auditor")) out.push("Accounting")
    if (text.includes("data analyst") || text.includes("business intelligence")) out.push("Analytics")
    if (text.includes("government") || text.includes("public sector")) out.push("Government")
    if (text.includes("attorney") || text.includes("paralegal")) out.push("Legal")
    if (text.includes("software engineer") || text.includes("full stack")) out.push("IT_Software")
    if (text.includes("mechanical engineer") || text.includes("biomedical engineer")) out.push("Engineering")
    if (text.includes("electrician") || text.includes("plumber")) out.push("Trades")
  }

  // Dedupe preserving first-seen order
  const unique = Array.from(new Set(out))

  // Cap at 4 to keep scoring focused, but leave room for legitimate
  // cross-functional candidates (e.g. "Strategy Consultant + Business Ops +
  // Chief of Staff + Product Marketing"). The cap was 2 historically which
  // silently dropped Engineering for biomedical candidates — that was a bug.
  return unique.length ? unique.slice(0, 4) : ["Other"]
}
