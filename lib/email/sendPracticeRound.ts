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
