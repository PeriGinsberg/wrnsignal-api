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
] as const

export type CoachClientEventType = (typeof COACH_CLIENT_EVENT_TYPES)[number]
