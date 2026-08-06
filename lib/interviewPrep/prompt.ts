// lib/interviewPrep/prompt.ts
//
// The one call. Three blocks out of a single structured response, not three
// calls: the exposures, the questions and the answers are the same argument
// told three ways, and generating them separately would let them disagree.
//
// WHY THERE IS NO SENTENCE TARGET, and why that is the load-bearing part of
// this file. The first version asked for "2 to 4 sentences each" while RULE 1
// demanded every claim come from the evidence. When the evidence is one resume
// line those two instructions are in direct conflict, and length won: the model
// padded to reach the count, inventing an accounting system, a threshold, a
// "system A" and a "system B" that appeared nowhere in the candidate's resume.
// Read on the page it was fluent and defensible-looking. In an interview it is
// a follow-up question the candidate cannot answer.
//
// So the target is gone rather than fought. Adding more prohibition while
// leaving a length goal in place would have kept them fighting, and length wins
// because it is the easier instruction to obey.
//
// There is deliberately NO semantic check on top. Set membership on evidence
// ids is the only validation that cannot false-reject, and KI-11 below is what
// happens when that line is crossed. A digit-extraction check was considered
// and rejected: it breaks on "$18,000" rendered as "18,000 dollar" and on
// "three-hour" rendered as "3", and normalising well enough to avoid false
// rejections is the same slope.
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
  "RULE 1a — NO ELABORATION. Do not add any system, tool, platform, threshold, number, team name, job title, date or mechanism that the evidence does not contain. If the evidence says a reconciliation was automated with pivot tables and VLOOKUP, you may say that. You may NOT say which systems were reconciled, how the formula was structured, or what it flagged. You do not know those things. The test: before writing a detail, ask whether an interviewer could follow up on it. If they asked \"which system?\" and the evidence does not answer, you invented it. Delete it.",
  "",
  "RULE 2 — COMPANY. Every claim about the company or the role must come from the JOB DESCRIPTION block. You do not know this company. You have no knowledge of its funding, leadership, products, customers, size, culture or recent news beyond what is written in that block. If the block does not say it, it is not true and you must not write it.",
  "",
  "RULE 3 — RISKS. Only produce exposures and probe questions from the RISKS block. If RISKS is empty, return empty arrays for exposure.probe and questions.probes. Never invent a risk.",
  "",
  "RULE 4 — OUTPUT. Return only valid JSON matching the requested shape. No markdown, no fences, no commentary before or after.",
  "",
  "RULE 5 — PUNCTUATION AND FORMATTING. Never use em dashes or en dashes. Use a comma, a full stop, or a new sentence. Never use markdown: no asterisks, no underscores, no backticks, no bold, no italics. Plain sentences only. This applies to every string you write.",
  "",
  "RULE 6 — NO ENTHUSIASM. Never claim the candidate is passionate, excited, eager, motivated, deeply interested, or genuinely interested in anything. Never write \"not looking for a job, looking for a career\" or any variation. You cannot know what someone feels, an interviewer discounts it on sight, and it takes the place of a fact that would have helped. Every sentence must carry something from the EVIDENCE block. The test: if a sentence would read exactly the same in a different candidate's prep, delete it.",
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
      // Was "the core things this posting asks for", which stopped being true
      // when the supporting tier was let in. Most important first is what the
      // ordering now actually promises.
      "REQUIREMENTS (what this posting asks for, most important first)",
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
      // "they_will_ask" produced the block 2 question verbatim, twice on one
      // page. The field is declarative now and says so three ways: the name,
      // the instruction, and the worked example.
      `   exposure.probe: one entry per RISK id, up to 3. "challenge" states the gap as a FACT about where the candidate stands, in ONE sentence. It is NOT a question and must never end with a question mark. Write "One year of experience against a role that usually asks for two to three", not "Why should we consider you with only one year?". The question form belongs in questions.probes and must not appear here. "how" is one line on handling it honestly.`,
      "",
      "2. QUESTIONS. What they will actually ask.",
      "   questions.certain: exactly one question per REQUIREMENT id, up to 3, drawn from what the posting asks for.",
      "   questions.probes: one question per RISK id, the version an interviewer would really say out loud.",
      `   questions.always: exactly 2, with "kind" set to "why_this_job" and "why_you".`,
      "",
      "3. ANSWERS. One answer for every question above.",
      "   LENGTH IS SET BY THE EVIDENCE, NOT BY A TARGET. If the evidence is one line, one or two sentences is a complete answer. A short answer that is entirely true beats a fluent one that invents. Never pad to sound thorough: padding is where invented detail comes from.",
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
      '    "probe": [{"risk_id": "r1", "challenge": "a statement, not a question", "how": "..."}]',
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
