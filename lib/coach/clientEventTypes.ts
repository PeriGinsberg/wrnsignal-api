// lib/coach/clientEventTypes.ts
//
// THE HISTORY VOCABULARY, and nothing else. It lives here rather than beside
// the writer because both sides need it: the server writes these strings, and
// the History tab must have wording for every one of them. The writer's module
// pulls in the service-role client, which a component test cannot load, so a
// shared list in app/api/_lib would leave the tab's coverage test unable to ask
// the question it exists to ask.
//
// Typed in code, never user input, which is why coach_client_events has no
// CHECK on event_type: this union is the source of truth.

export const COACH_CLIENT_EVENT_TYPES = [
  "prospect_created",
  "stage_changed",
  "converted_to_client",
  "proposal_sent",
  "proposal_approved",
  "proposal_declined",
  "engagement_attached",
  "engagement_detached",
  "activity_completed",
  "invite_sent",
  "account_created",
  // An invite that is sent and never seen to be accepted reads as though it
  // vanished. The pair belongs together.
  "invite_accepted",
  // A workbook's handoffs. Not its contents: field answers live in
  // workbook_answer_history, and coach drafts are private until a send.
  "workbook_created",
  "workbook_shared",
  "workbook_sent_for_review",
  "workbook_returned",
  "homework_complete",
  // Only the failure. A successful send always follows homework_complete by
  // under a second and is already stamped on workbooks.homework_webhook_at.
  "homework_webhook_failed",

  // ── The coaching task chain ──
  //
  // THESE ARE AUDIT, NOT NOTES. A note is something a coach chose to write
  // down; these happen whether or not anyone was watching. Mixing them put
  // "Networking plan shared with client" into the note feed, where it sat
  // between a session recap and a coach's own observations looking like
  // something a person had typed.
  "campaign_brief_submitted",
  "task_created",
  "task_completed",
  "task_reopened",
  "task_reassigned",
  "networking_plan_generated",
  "networking_plan_shared",
  // The recipient rides in context. "An email went out" is worth little
  // without "to whom", which is the question asked when a client says they
  // never got it.
  "client_email_sent",

  // Practice rounds. Separate from workbooks by design, but the History tab is
  // one timeline for the relationship, so they belong on it.
  "practice_round_sent",
  "practice_round_submitted",
  "practice_feedback_sent",
  // ── The prospect workflow (Phase 1, 2026-10-02) ──
  // A move back is its own type: "Moved to stage X" would read as progress.
  "stage_moved_back",
  // Reason, its detail and the notes ride in context, so reopening (which
  // clears them on the record) loses nothing.
  "prospect_lost",
  "prospect_reopened",
  "consult_booked",
  // Context holds the values the save replaced: the record of what the
  // booking (or an earlier save) said before the consult became official.
  "consult_saved",
  "consult_completed",
  "consult_no_show",
  // The public booking form (Phase 2). Context keeps every answer as given,
  // and who filled it in: a parent's submission says so.
  "booking_form_submitted",
  // Phase 3: a consult cancelled on Calendly. Context: the date it was for, the
  // reason they gave, and who cancelled (the invitee or the host).
  "consult_cancelled",
  // Client phases: a phase's status moved. Context: the phase's label, from and
  // to, and auto=true when SIGNAL moved it (a task in the phase started).
  "phase_status_changed",
  // The client's plan changed (pass A): a task's state, or a customisation.
  // Context.action says which: task_state (from/to, auto when SIGNAL did it),
  // task_added, task_removed, task_assigned, task_due, tasks_reordered,
  // deliverable_added, deliverable_removed, deliverable_not_needed,
  // deliverable_restored.
  "plan_changed",
  // A client's SOW (lib/sow/send.ts). sow_sent: context has the package name,
  // to, cc, the send number and the subject. sow_withdrawn: another package's
  // SOW went out, so this one's link stopped working (context: name, replaced_by).
  "sow_sent",
  "sow_withdrawn",
  // Let's Go. Context: the typed name, the package, and changed_after_send
  // when the package was edited after the SOW went out without a re-send.
  "sow_accepted",
  // The client's Google Drive workspace (lib/sow/workspace.ts): made at
  // Let's Go (context: folder name, url), shared with the client when the
  // welcome task is released (context: email, url).
  "workspace_created",
  "workspace_shared",
  // The welcome email (lib/welcome/service.ts), sent when the coach releases
  // the welcome task. welcome_email_sent: to, cc, subject, the template's
  // name and the task. welcome_email_skipped: the coach chose Don't send and
  // the task went out without it (context: task).
  "welcome_email_sent",
  "welcome_email_skipped",
] as const

export type CoachClientEventType = (typeof COACH_CLIENT_EVENT_TYPES)[number]
