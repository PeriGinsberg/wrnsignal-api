// lib/interviewPrep/prompt.ts
//
// The one call. Three blocks out of a single structured response, not three
// calls: the exposures, the questions and the answers are the same argument
// told three ways, and generating them separately would let them disagree.
//
// GROUNDING. A correction worth recording, because the brief named the wrong
// ancestor: Phase 2's groundingValidator is NOT in production. It exists as a
// skeleton and the runlog measures it at a ~100% false-reject rate, 5x past its
// own FRD threshold; it was deferred as KI-11 and never redesigned. The
// discipline that actually ships in this repo is prompt-level, in
// bulletGeneratorV5.ts: cite only what is in the input, never "you likely",
// never invent a risk that was not passed in.
//
// This file carries that, plus the one mechanical check the validator never
// got — every drafted answer must name the evidence ids it rests on, and an
// answer citing an id that was not supplied is dropped. Set membership, so it
// has no false-reject problem. See validate.ts.
//
// COMPANY KNOWLEDGE IS JD-ONLY, enforced two ways. Rule 2 says so, and the
// response schema has no field for company research, so there is nothing to
// fill. The second is the stronger of the two.
//
// Pure — builds strings, makes no call.

import type { PrepSource } from "./source"

export const MAX_TOKENS = 2500

/** Deterministic given the cache; see contentHash.ts on why that phrasing matters. */
export const TEMPERATURE = 0

export const SYSTEM_PROMPT = [
  "You prepare a specific candidate for a specific interview. You write in second person, directly to the candidate.",
  "",
  "RULE 1 — EVIDENCE. Every claim about the candidate must come from the EVIDENCE block, quoted or closely paraphrased. Never write \"you likely\", \"you probably\", or \"your background suggests\". If the evidence does not say it, the candidate cannot say it in the room, so you must not draft it.",
  "",
  "RULE 2 — COMPANY. Every claim about the company or the role must come from the JOB DESCRIPTION block. You do not know this company. You have no knowledge of its funding, leadership, products, customers, size, culture or recent news beyond what is written in that block. If the block does not say it, it is not true and you must not write it.",
  "",
  "RULE 3 — RISKS. Only produce exposures and probe questions from the RISKS block. If RISKS is empty, return empty arrays for exposure.probe and questions.probes. Never invent a risk.",
  "",
  "RULE 4 — OUTPUT. Return only valid JSON matching the requested shape. No markdown, no fences, no commentary before or after.",
].join("\n")

function block(title: string, body: string): string {
  return `${title}\n${body}\n`
}

export function buildUserPrompt(src: PrepSource): string {
  const parts: string[] = []

  parts.push(
    block(
      "ROLE",
      [
        `title: ${src.role.jobTitle ?? "unknown"}`,
        `company: ${src.role.companyName ?? "unknown"}`,
        `field: ${src.role.jobFamily ?? "unknown"}`,
        src.role.yearsRequired != null ? `years asked for: ${src.role.yearsRequired}` : null,
        src.role.decision ? `SIGNAL verdict: ${src.role.decision}${src.role.score != null ? ` (${src.role.score})` : ""}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  )

  parts.push(
    block(
      "JOB DESCRIPTION",
      src.jobDescription
        ? src.jobDescription
        : "(not available — you know nothing about this company beyond the ROLE block above)",
    ),
  )

  parts.push(
    block(
      "REQUIREMENTS (the core things this posting asks for)",
      src.requirements.length
        ? src.requirements
            .map((r) => `[${r.id}] ${r.label}${r.snippet ? ` — from the posting: "${r.snippet}"` : ""}`)
            .join("\n")
        : "(none extracted)",
    ),
  )

  parts.push(
    block(
      "STRENGTHS (where this candidate matches, with the proof)",
      src.strengths
        .map(
          (s) =>
            `[${s.id}] the job asks: "${s.job_fact}"\n      the candidate has (${s.match_strength}): "${s.profile_fact}" [evidence ${s.evidence_id}]`,
        )
        .join("\n"),
    ),
  )

  parts.push(
    block(
      "RISKS (where this candidate is exposed)",
      src.risks.length
        ? src.risks
            .map(
              (r) =>
                `[${r.id}] (${r.severity}) ${r.risk}\n      job side: "${r.job_fact}"${r.profile_fact ? `\n      candidate side: "${r.profile_fact}"${r.evidence_id ? ` [evidence ${r.evidence_id}]` : ""}` : ""}`,
            )
            .join("\n")
        : "(none — return empty arrays for exposure.probe and questions.probes)",
    ),
  )

  parts.push(
    block(
      "EVIDENCE (the ONLY things you may say the candidate has done)",
      src.evidence.map((e) => `[${e.id}] "${e.text}"`).join("\n"),
    ),
  )

  parts.push(
    [
      "TASK",
      "",
      "Produce three things about this one interview.",
      "",
      "1. EXPOSURE. What they will want proved, and what they will push on.",
      `   exposure.prove: up to 3 entries, one per STRENGTH id. "claim" is what the candidate should be able to demonstrate; "how" is one line on how to bring it up.`,
      `   exposure.probe: one entry per RISK id, up to 3. "they_will_ask" is how that risk shows up as an interviewer's doubt; "how" is one line on handling it honestly.`,
      "",
      "2. QUESTIONS. What they will actually ask.",
      "   questions.certain: exactly one question per REQUIREMENT id, up to 3, drawn from what the posting asks for.",
      "   questions.probes: one question per RISK id, the version an interviewer would really say out loud.",
      `   questions.always: exactly 2, with "kind" set to "why_this_job" and "why_you".`,
      "",
      "3. ANSWERS. One answer for every question above, 2 to 4 sentences each.",
      `   question_ref must be "req:<id>" for a certain question, "risk:<id>" for a probe, and "always:why_this_job" or "always:why_you" for the last two.`,
      "   evidence_ids must list every EVIDENCE id the answer draws on, and only ids that appear in the EVIDENCE block.",
      "   An answer with nothing to stand on must not be written. Leave it out rather than filling it in.",
      "",
      `Set jd_depth to "thin" if the JOB DESCRIPTION block is too short or too vague to tell you what this job actually involves, otherwise "adequate".`,
      "",
      "Return exactly this JSON:",
      "{",
      '  "jd_depth": "thin" | "adequate",',
      '  "exposure": {',
      '    "prove": [{"why_id": "w1", "claim": "...", "how": "..."}],',
      '    "probe": [{"risk_id": "r1", "they_will_ask": "...", "how": "..."}]',
      "  },",
      '  "questions": {',
      '    "certain": [{"req_id": "...", "question": "..."}],',
      '    "probes": [{"risk_id": "r1", "question": "..."}],',
      '    "always": [{"kind": "why_this_job", "question": "..."}, {"kind": "why_you", "question": "..."}]',
      "  },",
      '  "answers": [{"question_ref": "req:...", "answer": "...", "evidence_ids": ["e1"]}]',
      "}",
    ].join("\n"),
  )

  return parts.join("\n")
}
