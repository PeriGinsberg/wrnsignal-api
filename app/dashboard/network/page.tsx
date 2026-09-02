"use client"

// /dashboard/network — THE Networking page. One screen, not two tabs.
//
// This route used to be a redirect into /contacts, which itself was one of two
// sibling tabs, the other being /companies. That split asked the student to
// decide whether they were thinking about a person or an organisation before
// they were allowed to look at either, and the answer is almost always both:
// you look at a company because you are about to write to someone who works
// there. So the roster is the page, companies open as a panel off a row, and
// the companies nobody works at yet are a strip above the list.
//
// The implementation is NetworkLanding rather than this file so that
// /dashboard/network/contacts can redirect here without either route file
// holding the screen. 44 links across the app still point at the old contacts
// URL and they all keep working.

import { NetworkLanding } from "./NetworkLanding"

export default function NetworkPage() {
  return <NetworkLanding />
}
