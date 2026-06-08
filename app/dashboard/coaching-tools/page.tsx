import { redirect } from "next/navigation"

// Coaching Tools has been renamed and re-homed to the Coaching Hub. This route is
// kept (not deleted) so existing bookmarks / deep-links don't 404 — it permanently
// redirects to the Hub.
export default function CoachingToolsRedirect() {
  redirect("/dashboard/coaching-hub")
}
