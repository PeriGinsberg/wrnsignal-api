// lib/email/sendPracticeRound.ts
//
// "Your coach sent you a practice round."
//
// Client-facing, so it goes through sendToClient and therefore carries the
// signal-client layout, the signature, and the non-production redirect. On
// staging this means the mail lands in Peri's inbox with the intended
// recipient in the subject, and the client is never written to.

import { sendToClient } from "./send"

export const PRACTICE_ROUND_TEMPLATE = "practice-round-ready"

/** Where the client lands. Absolute, because it is going into an email. */
export function practiceRoundUrl(roundId: string): string {
  const base = (process.env.APP_BASE_URL || "https://wrnsignal-api.vercel.app").replace(/\/+$/, "")
  return `${base}/dashboard/practice/${roundId}`
}

export async function sendPracticeRoundEmail(args: {
  to: string
  firstName: string
  coachName: string
  questionCount: number
  seconds: number
  roundId: string
}) {
  return sendToClient({
    to: args.to,
    templateAlias: PRACTICE_ROUND_TEMPLATE,
    model: {
      first_name: args.firstName,
      coach_name: args.coachName,
      question_count: args.questionCount,
      // Rendered rather than computed in the template: Mustachio has no
      // arithmetic and no pluraliser, so the sentence is built here.
      question_word: args.questionCount === 1 ? "question" : "questions",
      seconds: args.seconds,
      practice_url: practiceRoundUrl(args.roundId),
    },
  })
}

export const PRACTICE_FEEDBACK_TEMPLATE = "practice-feedback-ready"

/**
 * "Your coach left feedback on your practice round."
 *
 * The feedback ITSELF is not in the email. It is written per question and sits
 * under the answer it is about, which is the only place it reads correctly;
 * flattening it into a mail would strip the thing that makes it useful. The
 * email is a nudge with a link.
 */
export async function sendPracticeFeedbackEmail(args: {
  to: string
  firstName: string
  coachName: string
  roundTitle: string
}) {
  return sendToClient({
    to: args.to,
    templateAlias: PRACTICE_FEEDBACK_TEMPLATE,
    model: {
      first_name: args.firstName,
      coach_name: args.coachName,
      round_title: args.roundTitle,
      practice_url: `${(process.env.APP_BASE_URL || "https://wrnsignal-api.vercel.app").replace(/\/+$/, "")}/dashboard/coaching-hub`,
    },
  })
}
