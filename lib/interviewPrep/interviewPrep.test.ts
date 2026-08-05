// Run: npx tsx lib/interviewPrep/interviewPrep.test.ts
//
// Covers the three pure modules behind Prep Now's generated zone. No network:
// the LLM call is the only impure step and it is not exercised here.
//
// The two run fixtures below are the SHAPES MEASURED ON DEV on 2026-08-05, not
// invented ones. That matters: `jobfit_run_id != NULL` does not imply the
// analysis exists, and the stub fixture is the case that would otherwise reach
// the model with a job title and nothing else.

import { buildPrepSource, jdIsThin, THIN_JD_CHARS } from "./source"
import { computeContentHash, PROMPT_VERSION } from "./contentHash"
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt"
import { parseResponse, validateGenerated } from "./validate"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

// ── Fixtures, copied from real dev rows ─────────────────────────────────────

/** The real run: 26 top-level keys, 37 job_signals keys, 3 why / 2 risk / 3 units. */
const REAL_RUN = {
  job_description: "Northshore Capital is hiring an Investment Analyst. ".repeat(20),
  result_json: {
    decision: "Review",
    score: 66,
    bullets: ["At Northfield Investment Partners, you built ... -> In your cover letter, open by ..."],
    risk_flags: ["This role is titled at a level above ..."],
    next_step: "Only proceed if you can reduce the top risks.",
    why_codes: [
      {
        code: "WHY_DIRECT_EXPERIENCE_PROOF",
        note: "Profile proof directly matches a concrete job requirement.",
        weight: 96,
        job_fact: "We're looking for someone with a finance or economics background, comfort with performance metrics like IRR and MOIC, and 0-2 years of experience",
        match_key: "analysis_reporting",
        match_kind: "execution",
        profile_fact: "- Processed payments and reimbursements with detailed recordkeeping and on-time financial reporting to membership and national organization",
        match_strength: "direct",
      },
      {
        code: "WHY_TOOL_MATCH",
        job_fact: "Strong Excel is a must",
        profile_fact: "- Built and maintained performance reporting in Excel across multiple fund strategies",
        match_strength: "direct",
      },
    ],
    risk_codes: [
      {
        code: "RISK_EXPERIENCE",
        risk: "This role is titled at a level above where early-career candidates are typically competitive.",
        weight: -18,
        job_fact: "Job title indicates a senior, manager, or leadership-level role.",
        severity: "medium",
        profile_fact: "Profile shows approximately 1 year of experience.",
      },
    ],
    job_signals: {
      jobTitle: "Investment Analyst",
      companyName: "Northshore Capital",
      jobFamily: "Finance",
      yearsRequired: 2,
      requiredTools: [],
      requirement_units: [
        {
          id: "8d2fbd65931ce46a",
          key: "financial_analysis",
          kind: "function",
          label: "financial analysis and investment work",
          snippet: "Strong Excel is a must — pivot tables, VLOOKUP, financial modeling.",
          strength: 9,
          functionTag: "finance_corp",
          requiredness: "core",
        },
        {
          id: "aaaa1111",
          key: "communication",
          label: "written communication",
          snippet: "You will prepare quarterly materials.",
          strength: 4,
          requiredness: "nice_to_have",
        },
        {
          id: "bbbb2222",
          key: "reporting",
          label: "performance reporting",
          snippet: "Maintain performance reporting across fund strategies.",
          strength: 7,
          requiredness: "core",
        },
      ],
    },
  },
}

/** The SEEDED run. Three top-level keys. This is what most dev rows look like. */
const STUB_RUN = {
  job_description: "Vertex Labs is hiring a Product Marketing Lead.",
  result_json: {
    decision: "Review",
    score: 71,
    job_signals: { jobTitle: "Product Marketing Lead", companyName: "Vertex Labs" },
  },
}

// ── buildPrepSource ─────────────────────────────────────────────────────────

console.log("\nbuildPrepSource")
{
  const src = buildPrepSource(REAL_RUN)!
  ok("a real run yields a source", src !== null)
  ok("role fields come off job_signals",
    src.role.jobTitle === "Investment Analyst" && src.role.companyName === "Northshore Capital"
    && src.role.jobFamily === "Finance" && src.role.yearsRequired === 2)
  ok("the verdict and score come along", src.role.decision === "Review" && src.role.score === 66)
  ok("both strengths survive with stable positional ids",
    src.strengths.length === 2 && src.strengths[0].id === "w1" && src.strengths[1].id === "w2")
  ok("the risk survives", src.risks.length === 1 && src.risks[0].id === "r1")
  ok("evidence is the union of the profile facts", src.evidence.length === 3)
  ok("each strength points at its evidence",
    src.strengths.every((s) => src.evidence.some((e) => e.id === s.evidence_id)))
  // requirement_units is the engine's own ranking; only core, strongest first.
  ok("only core requirements are offered", src.requirements.length === 2)
  ok("core requirements are strongest first",
    src.requirements[0].id === "8d2fbd65931ce46a" && src.requirements[1].id === "bbbb2222")
  ok("the nice-to-have unit is excluded",
    !src.requirements.some((r) => r.id === "aaaa1111"))
}

// THE CASE THIS MODULE EXISTS FOR.
ok("a SEEDED stub run yields null, not a thin source", buildPrepSource(STUB_RUN) === null)

// THE SECOND ONE, found by pressing the button on dev and watching nothing
// happen. A force_pass gate is a COMPLETE run — 26 keys, 6 risks, 3 requirement
// units — but enforceClientFacingRules zeroes why_codes on it, so there is no
// evidence to ground an answer in. It must still return null, and the caller
// must be able to tell this apart from a stub, because "rescore it" is true
// advice for one and false for the other.
{
  const GATED_PASS_RUN = {
    job_description: "U.S. Bank is hiring. ".repeat(30),
    result_json: {
      decision: "Pass",
      score: 25,
      gate_triggered: {
        type: "force_pass",
        gateCode: "GATE_EXPERIENCE_GAP",
        detail: "This role requires 5+ years of experience.",
      },
      why_codes: [],
      risk_codes: [
        { code: "RISK_EXPERIENCE", risk: "Too junior for the title.", job_fact: "5+ years", severity: "high" },
      ],
      job_signals: {
        jobTitle: "Risk Manager",
        companyName: "U.S. Bank",
        requirement_units: [
          { id: "u1", label: "risk management", snippet: "5+ years in risk.", strength: 9, requiredness: "core" },
        ],
      },
    },
  }
  ok("a force_pass run yields null even though it has risks and requirements",
    buildPrepSource(GATED_PASS_RUN) === null)
  ok("...and the gate is still readable by the caller, so it can say WHY",
    (GATED_PASS_RUN.result_json as any).gate_triggered.type === "force_pass")
}
ok("null run is null", buildPrepSource(null) === null)
ok("a run with no result_json is null", buildPrepSource({ result_json: null }) === null)
ok("a run with why_codes but no profile_fact is null — nothing to ground on",
  buildPrepSource({
    result_json: { why_codes: [{ job_fact: "asks for X", profile_fact: "" }], job_signals: {} },
  }) === null)
{
  // The same resume line is often the proof of one thing and the thin spot in
  // another. It must be ONE evidence entry, not two.
  const src = buildPrepSource({
    result_json: {
      why_codes: [{ job_fact: "asks for X", profile_fact: "did X" }],
      risk_codes: [{ risk: "thin on X", job_fact: "needs deep X", profile_fact: "did X" }],
      job_signals: {},
    },
  })!
  ok("a shared profile_fact is deduped to one evidence entry", src.evidence.length === 1)
  ok("the strength and the risk point at the same evidence id",
    src.strengths[0].evidence_id === src.risks[0].evidence_id)
}
{
  const src = buildPrepSource({
    result_json: {
      why_codes: [{ job_fact: "asks", profile_fact: "did" }],
      risk_codes: [{ risk: "JD-side gate", job_fact: "requires a licence" }],
      job_signals: {},
    },
  })!
  ok("a risk with no candidate side still survives, with no evidence id",
    src.risks.length === 1 && src.risks[0].evidence_id === "")
}

console.log("\njdIsThin")
ok("a short posting is thin", jdIsThin("x".repeat(645)))
ok("a full posting is not", !jdIsThin("x".repeat(THIN_JD_CHARS + 1)))
ok("a missing posting is thin by definition", jdIsThin(null))

// ── contentHash ─────────────────────────────────────────────────────────────

console.log("\ncomputeContentHash")
{
  const base = { model: "m", jobfitRunId: "run-1", runFingerprint: "fp-1", stage: "phone", format: "virtual" }
  const h = computeContentHash(base)
  ok("same inputs, same hash", computeContentHash({ ...base }) === h)
  ok("it is a sha256 hex digest", /^[0-9a-f]{64}$/.test(h))

  // Each of these changes what the model is asked, so each must invalidate.
  ok("a different run invalidates", computeContentHash({ ...base, jobfitRunId: "run-2" }) !== h)
  ok("a rescore (new fingerprint) invalidates", computeContentHash({ ...base, runFingerprint: "fp-2" }) !== h)
  ok("a stage change invalidates", computeContentHash({ ...base, stage: "final_round" }) !== h)
  ok("a format change invalidates", computeContentHash({ ...base, format: "in_person" }) !== h)
  ok("a model bump invalidates", computeContentHash({ ...base, model: "m2" }) !== h)

  // null format is a real state the prompt branches on, not a missing input.
  ok("null format hashes differently from a set one",
    computeContentHash({ ...base, format: null }) !== h)
  ok("null format is stable with itself",
    computeContentHash({ ...base, format: null }) === computeContentHash({ ...base, format: null }))
  ok("a null fingerprint is stable",
    computeContentHash({ ...base, runFingerprint: null }) === computeContentHash({ ...base, runFingerprint: null }))
  ok("PROMPT_VERSION is a number so a prompt edit can re-freeze", typeof PROMPT_VERSION === "number")
}

// ── prompt ──────────────────────────────────────────────────────────────────

console.log("\nbuildUserPrompt")
{
  const src = buildPrepSource(REAL_RUN)!
  const p = buildUserPrompt(src)
  ok("the JD text is included", p.includes("Northshore Capital is hiring"))
  ok("every evidence line is included", src.evidence.every((e) => p.includes(e.text)))
  ok("every strength id is included", src.strengths.every((s) => p.includes(`[${s.id}]`)))
  ok("every requirement id is included", src.requirements.every((r) => p.includes(`[${r.id}]`)))
  ok("the ref format is spelled out for the model", p.includes("req:<id>") && p.includes("always:why_you"))
  // The resume itself is deliberately NOT sent — only the engine's chosen facts.
  ok("the four grounding rules are in the system prompt",
    SYSTEM_PROMPT.includes("RULE 1") && SYSTEM_PROMPT.includes("RULE 2")
    && SYSTEM_PROMPT.includes("RULE 3") && SYSTEM_PROMPT.includes("RULE 4"))
  ok("the system prompt forbids company knowledge beyond the JD",
    SYSTEM_PROMPT.includes("You do not know this company"))
}
{
  const src = buildPrepSource({
    result_json: { why_codes: [{ job_fact: "asks", profile_fact: "did" }], job_signals: {} },
  })!
  const p = buildUserPrompt(src)
  ok("with no risks the prompt says to return empty arrays",
    p.includes("return empty arrays for exposure.probe and questions.probes"))
  ok("with no JD the prompt says so rather than leaving a blank",
    p.includes("not available"))
}

// ── validate ────────────────────────────────────────────────────────────────

console.log("\nparseResponse")
ok("plain JSON parses", parseResponse('{"a":1}')?.a === 1)
ok("a preamble before the brace is tolerated", parseResponse('Here you go:\n{"a":1}')?.a === 1)
ok("garbage is null", parseResponse("not json at all") === null)
ok("truncated JSON is null", parseResponse('{"a":') === null)

console.log("\nvalidateGenerated")
{
  const src = buildPrepSource(REAL_RUN)!
  const good = {
    jd_depth: "adequate",
    exposure: {
      prove: [{ why_id: "w1", claim: "You have done the reporting", how: "Lead with it" }],
      probe: [{ risk_id: "r1", they_will_ask: "Are you senior enough", how: "Name the scope you held" }],
    },
    questions: {
      certain: [{ req_id: "8d2fbd65931ce46a", question: "Walk me through a model you built." }],
      probes: [{ risk_id: "r1", question: "This is a step up. Why you?" }],
      always: [
        { kind: "why_this_job", question: "Why this job?" },
        { kind: "why_you", question: "Why should we hire you?" },
      ],
    },
    answers: [
      { question_ref: "req:8d2fbd65931ce46a", answer: "At Northfield I ...", evidence_ids: ["e2"] },
      { question_ref: "risk:r1", answer: "One year, but ...", evidence_ids: ["e3"] },
      { question_ref: "always:why_this_job", answer: "Because ...", evidence_ids: ["e1"] },
      { question_ref: "always:why_you", answer: "Because ...", evidence_ids: ["e1", "e2"] },
    ],
  }
  const v = validateGenerated(good, src)!
  ok("a well-formed response survives whole", v !== null)
  ok("all four answers survive", v.answers.length === 4)
  ok("evidence is resolved to TEXT, not left as ids",
    v.answers[0].evidence[0].text === src.evidence[1].text)
  ok("refs are built server-side, not taken from the model",
    v.questions.certain[0].ref === "req:8d2fbd65931ce46a")
  ok("both always-questions survive", v.questions.always.length === 2)
  ok("jd_depth passes through", v.jd_depth === "adequate")

  // ── the drop rules, one at a time ────────────────────────────────────────

  const invented = validateGenerated({
    ...good,
    exposure: { prove: [{ why_id: "w9", claim: "invented", how: "x" }], probe: [] },
  }, src)!
  ok("a prove entry citing an unknown strength id is dropped", invented.exposure.prove.length === 0)
  ok("...and the rest of the response is untouched", invented.answers.length === 4)

  const badReq = validateGenerated({
    ...good,
    questions: { ...good.questions, certain: [{ req_id: "not-a-real-id", question: "?" }] },
  }, src)!
  ok("a question citing an unknown requirement id is dropped", badReq.questions.certain.length === 0)
  ok("...and its answer goes with it, having no question left",
    !badReq.answers.some((a) => a.question_ref.startsWith("req:")))

  const badEvidence = validateGenerated({
    ...good,
    answers: [...good.answers.slice(1), { question_ref: "req:8d2fbd65931ce46a", answer: "made up", evidence_ids: ["e99"] }],
  }, src)!
  ok("an answer citing evidence that was never supplied is dropped",
    !badEvidence.answers.some((a) => a.answer === "made up"))

  const noEvidence = validateGenerated({
    ...good,
    answers: [...good.answers.slice(1), { question_ref: "req:8d2fbd65931ce46a", answer: "ungrounded", evidence_ids: [] }],
  }, src)!
  ok("an answer with no evidence at all is dropped",
    !noEvidence.answers.some((a) => a.answer === "ungrounded"))

  const partialEvidence = validateGenerated({
    ...good,
    answers: [{ question_ref: "req:8d2fbd65931ce46a", answer: "half real", evidence_ids: ["e1", "e99"] }],
  }, src)!
  ok("a mixed answer keeps the real ids and drops the invented one",
    partialEvidence.answers[0].evidence.length === 1 && partialEvidence.answers[0].evidence[0].id === "e1")

  const dupes = validateGenerated({
    ...good,
    questions: {
      ...good.questions,
      always: [
        { kind: "why_you", question: "first" },
        { kind: "why_you", question: "second" },
      ],
    },
  }, src)!
  ok("a repeated always-kind keeps only the first", dupes.questions.always.length === 1)

  const capped = validateGenerated({
    ...good,
    exposure: {
      prove: [
        { why_id: "w1", claim: "a", how: "x" }, { why_id: "w2", claim: "b", how: "x" },
        { why_id: "w1", claim: "c", how: "x" }, { why_id: "w2", claim: "d", how: "x" },
      ],
      probe: good.exposure.probe,
    },
  }, src)!
  ok("prove is capped at 3", capped.exposure.prove.length === 3)

  ok("jd_depth thin passes through", validateGenerated({ ...good, jd_depth: "thin" }, src)!.jd_depth === "thin")
  ok("an unrecognised jd_depth falls back to adequate",
    validateGenerated({ ...good, jd_depth: "banana" }, src)!.jd_depth === "adequate")

  // ── fail closed ──────────────────────────────────────────────────────────

  ok("no questions at all returns null",
    validateGenerated({ ...good, questions: { certain: [], probes: [], always: [] } }, src) === null)
  ok("no surviving answers returns null",
    validateGenerated({ ...good, answers: [] }, src) === null)
  ok("a non-object returns null", validateGenerated("nope", src) === null)
  ok("null returns null", validateGenerated(null, src) === null)
  ok("an empty object returns null", validateGenerated({}, src) === null)
}
{
  // RULE 3 held mechanically: a run with no risks cannot produce risk output,
  // whatever the model returns.
  const src = buildPrepSource({
    result_json: { why_codes: [{ job_fact: "asks", profile_fact: "did" }], job_signals: {} },
  })!
  const v = validateGenerated({
    jd_depth: "adequate",
    exposure: { prove: [], probe: [{ risk_id: "r1", they_will_ask: "invented risk", how: "x" }] },
    questions: {
      certain: [], probes: [{ risk_id: "r1", question: "invented probe" }],
      always: [{ kind: "why_you", question: "Why you?" }],
    },
    answers: [{ question_ref: "always:why_you", answer: "Because ...", evidence_ids: ["e1"] }],
  }, src)!
  ok("with no risks in, no probe exposure comes out", v.exposure.probe.length === 0)
  ok("with no risks in, no probe question comes out", v.questions.probes.length === 0)
  ok("the grounded always-answer still survives", v.answers.length === 1)
}

console.log(failures === 0 ? "\nall interviewPrep assertions passed\n" : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
