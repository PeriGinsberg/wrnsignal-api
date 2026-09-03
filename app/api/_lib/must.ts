// app/api/_lib/must.ts
//
// A FAILED QUERY MUST NOT LOOK LIKE AN EMPTY RESULT.
//
// Supabase returns { data, error }. Destructuring only `data` turns any failure
// into `null`, and `null ?? []` turns that into an empty list. The route then
// carries on and answers 200 with nothing in it, which reads to everyone
// downstream as "there is no data" rather than "the query broke".
//
// THIS IS NOT HYPOTHETICAL AND IT IS NOT NEW. The networking profile route hit
// exactly this and carried a version of this helper with a comment explaining
// it: a select errored, the row came back null, the route read that as "no row
// yet", re-seeded, failed the same way, and answered profile: null. Nothing in
// the logs, nothing on screen. That helper was deleted along with that route,
// and the same shape immediately reappeared on five reads in the message work.
//
// THE CASE THAT MADE IT URGENT is worse than a blank screen. Three of those
// five reads feed computeNextDue, and the engine's answer is WRITTEN back to
// network_contacts. A swallowed read means the engine sees zero actions,
// concludes the contact has never been touched, and persists a due date and
// possibly a stage to match. A missing column stops being a rendering bug and
// becomes data the product invented.
//
// So: every query whose result the response or a write depends on goes through
// here, and the next missing column is a 500 naming it rather than a screen
// that quietly says you have nothing.
//
// NOT for genuinely optional reads. A query whose failure should degrade the
// page rather than fail it should keep destructuring `data` alone AND say in a
// comment why the degradation is correct.

export function must<T>(
  res: { data: T; error: { message: string } | null },
  what: string,
): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`)
  return res.data
}
