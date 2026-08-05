// Run: npx tsx lib/interviewPrep/interviewPrep.test.ts
//
// Covers the three pure modules behind Prep Now's generated zone. No network:
// the LLM call is the only impure step and it is not exercised here.
//
// The two run fixtures below are the SHAPES MEASURED ON DEV on 2026-08-05, not
// invented ones. That matters: `jobfit_run_id != NULL` does not imply the
// analysis exists, and the stub fixture is the case that would otherwise reach
// the model with a job title and nothing else.

import { buildPrepSource, jdState, THIN_JD_CHARS } from "./source"
import { computeContentHash, PROMPT_VERSION } from "./contentHash"
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt"
import { parseResponse, prose, validateGenerated } from "./validate"

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
          // SUPPORTING, and scored HIGHER than one of the core units on
          // purpose: the tier has to beat strength, or a strong supporting
          // requirement would outrank a weak core one.
          id: "aaaa1111",
          key: "communication",
          label: "written communication",
          snippet: "You will prepare quarterly materials.",
          strength: 8,
          requiredness: "supporting",
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
  // requirement_units is the engine's own ranking: core tier first, then
  // supporting, and strongest first inside each tier.
  ok("both core and supporting requirements are offered", src.requirements.length === 3)
  // The fixture's supporting unit scores 8, above the core unit at 7. Tier has
  // to win, or a strong supporting requirement outranks a weak core one.
  ok("core comes before supporting even when supporting scores higher",
    src.requirements[0].id === "8d2fbd65931ce46a"
    && src.requirements[1].id === "bbbb2222"
    && src.requirements[2].id === "aaaa1111")
  ok("strength orders within a tier", src.requirements[0].id === "8d2fbd65931ce46a")
}

// THE 28% CASE. 41 of 144 usable dev runs carry supporting units and no core
// at all. A core-only filter returned nothing for every one of them, which
// removed the requirements block and left the prep with two generic questions.
{
  const src = buildPrepSource({
    job_description: "x".repeat(2000),
    result_json: {
      why_codes: [{ job_fact: "asks for modelling", profile_fact: "built models" }],
      job_signals: {
        jobTitle: "Financial Analyst, FP&A",
        requirement_units: [
          { id: "s1", label: "analysis, reporting, and measurement work", snippet: "- 0-2 years of experience in FP&A", strength: 6, requiredness: "supporting" },
          { id: "s2", label: "excel tool usage", snippet: "- Strong financial modeling and Excel skills", strength: 9, requiredness: "supporting" },
          { id: "s3", label: "accounting and financial operations work", snippet: "- Bachelor's degree in Finance", strength: 3, requiredness: "supporting" },
        ],
      },
    },
  })!
  ok("a run with ONLY supporting units still yields requirements", src.requirements.length === 3)
  ok("...ordered by strength within the tier",
    src.requirements[0].id === "s2" && src.requirements[1].id === "s1" && src.requirements[2].id === "s3")
  ok("...and they carry the posting's own words", src.requirements[0].snippet.includes("Excel skills"))
}

// The cap is on the combined list, not per tier.
{
  const many = Array.from({ length: 9 }, (_, i) => ({
    id: `u${i}`, label: `thing ${i}`, snippet: "s", strength: 9 - i,
    requiredness: i < 2 ? "core" : "supporting",
  }))
  const src = buildPrepSource({
    result_json: {
      why_codes: [{ job_fact: "asks", profile_fact: "did" }],
      job_signals: { requirement_units: many },
    },
  })!
  ok("no more than 5 requirements are ever offered", src.requirements.length === 5)
  ok("the two core ones are both kept", src.requirements[0].id === "u0" && src.requirements[1].id === "u1")
}

// An unrecognised tier means the engine's shape changed. Dropped, not ranked
// last and shown: requiredness is typed "core" | "supporting" and nothing else
// is reachable today.
{
  const src = buildPrepSource({
    result_json: {
      why_codes: [{ job_fact: "asks", profile_fact: "did" }],
      job_signals: {
        requirement_units: [
          { id: "ok1", label: "real", snippet: "s", strength: 5, requiredness: "core" },
          { id: "weird", label: "unknown tier", snippet: "s", strength: 9, requiredness: "nice_to_have" },
          { id: "none", label: "no tier", snippet: "s", strength: 9 },
        ],
      },
    },
  })!
  ok("an unrecognised requiredness is dropped, not ranked last",
    src.requirements.length === 1 && src.requirements[0].id === "ok1")
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

console.log("\njdState")
ok("a short posting is thin", jdState("x".repeat(645)) === "thin")
ok("a full posting is ok", jdState("x".repeat(THIN_JD_CHARS + 1)) === "ok")
ok("exactly at the threshold is ok", jdState("x".repeat(THIN_JD_CHARS)) === "ok")
// ABSENT IS NOT THIN. Runs before 2026-04-10 never stored the posting, so
// calling it "short" would be a false statement about the user's own data.
ok("a missing posting is ABSENT, not thin", jdState(null) === "absent")
ok("an empty posting is absent too", jdState("") === "absent")

// A run with no stored posting is still worth generating from: the engine
// extracted its requirements, strengths and risks at scan time.
{
  const src = buildPrepSource({
    result_json: {
      why_codes: [{ job_fact: "asks for reporting", profile_fact: "did reporting" }],
      risk_codes: [{ risk: "thin on scale", job_fact: "large team" }],
      job_signals: {
        jobTitle: "Analyst",
        requirement_units: [{ id: "u1", label: "reporting", snippet: "", strength: 8, requiredness: "core" }],
      },
    },
    job_description: null,
  })!
  ok("a run with NO posting still yields a source", src !== null)
  ok("...with its jobDescription null rather than an empty string", src.jobDescription === null)
  ok("...and the engine's extracted requirements survive", src.requirements.length === 1)
  ok("...and the prompt tells the model it has no company knowledge",
    buildUserPrompt(src).includes("not available"))
}

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
  ok("all six rules are in the system prompt",
    ["RULE 1", "RULE 2", "RULE 3", "RULE 4", "RULE 5", "RULE 6"].every((r) => SYSTEM_PROMPT.includes(r)))
  ok("the formatting rule bans markdown as well as dashes",
    SYSTEM_PROMPT.includes("em dashes") && SYSTEM_PROMPT.includes("no asterisks"))
  // Observed live: "a genuine passion for learning" and "not looking for a job,
  // looking to build a career". Neither is grounded in anything.
  ok("the enthusiasm rule names the failure and gives a test",
    SYSTEM_PROMPT.includes("passionate") && SYSTEM_PROMPT.includes("different candidate's prep"))
  // Three ways, because one was not enough: the field name, the instruction,
  // and a worked example of right and wrong.
  ok("the prompt asks for a declarative challenge and shows both forms",
    p.includes("must never end with a question mark")
    && p.includes("One year of experience against a role that usually asks for two to three")
    && p.includes("a statement, not a question"))
  ok("the superseded field name is gone from the prompt entirely",
    !p.includes("they_will_ask"))
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

console.log("\nprose — house style")
// THE FOUR STRINGS BELOW ARE VERBATIM FROM A LIVE GOLDMAN SACHS GENERATION on
// 2026-08-05. The first version of this function was written against invented
// examples with spaces around the dashes, and every dash Haiku actually
// produced was unspaced, so the rule was exactly backwards.
ok("an UNSPACED em dash is a clause break, not a word join",
  prose("Explain how you managed the $80,000+ budget—what systems you used.")
    === "Explain how you managed the $80,000+ budget, what systems you used.")
ok("a numeric range keeps a hyphen and does NOT become a comma",
  prose("candidates with 2–3 years of finance experience")
    === "candidates with 2-3 years of finance experience")
ok("a pair of unspaced dashes around an aside both convert",
  prose("strong technical skills—advanced Excel and modeling—with a track record")
    === "strong technical skills, advanced Excel and modeling, with a track record")
ok("markdown emphasis is stripped, not printed",
  prose("the depth of what you *have* done in that year—especially the Excel modeling")
    === "the depth of what you have done in that year, especially the Excel modeling")

ok("a spaced em dash still becomes a comma",
  prose("You did the work — say so.") === "You did the work, say so.")
ok("an en dash between words is treated the same",
  prose("Two years – nearly three – in reporting.") === "Two years, nearly three, in reporting.")
// A REAL HYPHEN is a different character and is never touched. That is what
// makes converting every dash safe: genuine word-joining does not use a dash.
ok("an existing hyphen is untouched", prose("a well-timed answer") === "a well-timed answer")
ok("a hyphenated compound survives", prose("state-of-the-art systems") === "state-of-the-art systems")
ok("several dashes in one string all go", !prose("a — b — c — d").includes("—"))
ok("no doubled comma is left behind", !prose("first, — second").includes(",,"))
ok("no space before a comma is left behind", !/\s,/.test(prose("first , — second")))
ok("a dash before a full stop does not strand a comma",
  prose("that is the point —.") === "that is the point.")

console.log("\nprose — markdown")
ok("bold is unwrapped", prose("what you **have** done") === "what you have done")
ok("italic is unwrapped", prose("what you *have* done") === "what you have done")
ok("an orphan asterisk is removed", prose("what you *have done") === "what you have done")
ok("underscore emphasis is unwrapped", prose("what you _have_ done") === "what you have done")
ok("backticks go", prose("use the `pivot` table") === "use the pivot table")
// snake_case and mid-word underscores are not emphasis and must survive.
ok("a snake_case token is not treated as emphasis",
  prose("the job_signals field") === "the job_signals field")

ok("ordinary text is unchanged", prose("Plain, ordinary text.") === "Plain, ordinary text.")
ok("empty in, empty out", prose(null) === "" && prose("") === "")
ok("the max length still applies", prose("x".repeat(50), 10).length === 10)
{
  // THE ONE PLACE IT MUST NOT REACH. Evidence is the candidate's own resume
  // line, not the model's writing, so it goes through untouched.
  const src = buildPrepSource({
    result_json: {
      why_codes: [{ job_fact: "asks", profile_fact: "Built models — fast — under deadline" }],
      job_signals: {},
    },
  })!
  const v = validateGenerated({
    jd_depth: "adequate",
    exposure: { prove: [], probe: [] },
    questions: { certain: [], probes: [], always: [{ kind: "why_you", question: "Why — you?" }] },
    answers: [{ question_ref: "always:why_you", answer: "Because — I did.", evidence_ids: ["e1"] }],
  }, src)!
  ok("the model's question is cleaned", v.questions.always[0].question === "Why, you?")
  ok("the model's answer is cleaned", v.answers[0].answer === "Because, I did.")
  ok("the candidate's own resume line keeps its dashes",
    v.answers[0].evidence[0].text === "Built models — fast — under deadline")
}

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
      probe: [{ risk_id: "r1", challenge: "One year against a role that asks for three", how: "Name the scope you held" }],
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

  // BLOCK 1 IS DECLARATIVE. A challenge phrased as a question is the exact
  // duplication the rename exists to stop, so it is dropped rather than shown
  // beside the identical block 2 question. Both strings below are verbatim from
  // the live Goldman Sachs run that surfaced this.
  {
    const asQuestion = validateGenerated({
      ...good,
      exposure: {
        prove: good.exposure.prove,
        probe: [{
          risk_id: "r1",
          challenge: "This role is typically filled by candidates with 2-3 years of finance or investment experience. You have about 1 year. Why should we consider you for an analyst-level role?",
          how: "Acknowledge the gap, then show the depth of that year.",
        }],
      },
    }, src)!
    ok("a challenge ending in a question mark is dropped", asQuestion.exposure.probe.length === 0)
    ok("...and the rest of the response is untouched", asQuestion.answers.length === 4)
    ok("...and the QUESTION form still survives in block 2, where it belongs",
      asQuestion.questions.probes.length === 1)
  }
  {
    const declarative = validateGenerated({
      ...good,
      exposure: {
        prove: [],
        probe: [{
          risk_id: "r1",
          challenge: "One year of experience against a role that usually asks for two to three.",
          how: "Acknowledge the gap, then show the depth of that year.",
        }],
      },
    }, src)!
    ok("a declarative challenge survives", declarative.exposure.probe.length === 1)
    ok("...and carries its handling line, which appears nowhere else",
      declarative.exposure.probe[0].how.startsWith("Acknowledge"))
  }
  ok("a question mark mid-sentence is not caught by the trailing check, by design",
    validateGenerated({
      ...good,
      exposure: { prove: [], probe: [{ risk_id: "r1", challenge: "Why so junior? They will ask.", how: "x" }] },
    }, src)!.exposure.probe.length === 1)

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
    exposure: { prove: [], probe: [{ risk_id: "r1", challenge: "invented risk", how: "x" }] },
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
