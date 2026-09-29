// Create and send a preset practice round, with nobody pressing anything.
//
// THE SAME ROWS THE COACH-BUILT FLOW MAKES. A preset round is a practice_rounds
// row with status 'sent' and practice_questions beneath it, exactly as if a
// coach had built and sent it. Nothing downstream can tell the difference,
// which is the point: recording, submitting, the coach's Required Action,
// the feedback boxes and the release all work already and none of them needed
// a line changed for this.
//
// The only thing that marks it is `source: 'preset'` on each question, which
// already existed alongside 'bank' and 'custom'.

import type { SupabaseClient } from "@supabase/supabase-js"
import { logCoachClientEvent } from "@/app/api/_lib/coachClientEvents"
import { sendPracticeRoundEmail } from "@/lib/email/sendPracticeRound"
import type { PracticePreset } from "./presets"

export type AutoRoundResult =
  | { ok: true; roundId: string; emailed: boolean; to: string }
  | { ok: false; reason: string }

/**
 * BEST EFFORT, ALWAYS. Every caller is a client finishing their homework, and
 * that request must succeed whatever happens here. A round that fails to send
 * is a coach starting one by hand; a completion that 500s is a client pressing
 * the button again and believing it did not work.
 */
export async function createAndSendPresetRound(
  db: SupabaseClient,
  args: {
    preset: PracticePreset
    coachClientId: string
    clientProfileId: string
    coachProfileId: string
    /** For the email. Resolved by the caller, which already has them. */
    clientEmail: string | null
    clientFirstName: string
    coachName: string
  },
): Promise<AutoRoundResult> {
  try {
    const { data: round, error } = await db
      .from("practice_rounds")
      .insert({
        coach_client_id: args.coachClientId,
        client_profile_id: args.clientProfileId,
        // WHOSE ROUND IS IT. The coach's, even though they did not build it:
        // they are the one who will watch it and write the feedback, and
        // coach_profile_id is what the review page authorises against.
        coach_profile_id: args.coachProfileId,
        title: args.preset.title,
        // SENT, NOT DRAFT. There is no second step coming. A draft here would
        // sit on the coach's Practice tab looking like unfinished work.
        status: "sent",
        sent_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle()
    if (error || !round) return { ok: false, reason: error?.message ?? "insert returned nothing" }

    const { error: qErr } = await db.from("practice_questions").insert(
      args.preset.questions.map((text, position) => ({
        round_id: round.id,
        text,
        position,
        source: "preset",
      })),
    )
    if (qErr) {
      // A round with no questions is a dead link in the client's inbox.
      await db.from("practice_rounds").delete().eq("id", round.id)
      return { ok: false, reason: qErr.message }
    }

    await logCoachClientEvent({
      coachClientId: args.coachClientId,
      eventType: "practice_round_sent",
      // NO ACTOR. Nobody sent it. Recording the client as the actor would read
      // as them sending themselves a practice round; recording the coach would
      // credit them with a decision they did not make.
      actorProfileId: null,
      context: { round_id: round.id, questions: args.preset.questions.length, preset: true },
    })

    if (!args.clientEmail) {
      return { ok: true, roundId: round.id, emailed: false, to: "" }
    }

    const mail = await sendPracticeRoundEmail({
      to: args.clientEmail,
      firstName: args.clientFirstName,
      coachName: args.coachName,
      questionCount: args.preset.questions.length,
      seconds: args.preset.seconds,
      roundId: round.id,
    })

    return { ok: true, roundId: round.id, emailed: Boolean(mail.ok), to: args.clientEmail }
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) }
  }
}
