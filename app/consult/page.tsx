// The public consult booking form. No login: this is the page the website's
// "Book a consult" button links to. See BookingForm.tsx for the form and
// app/api/public/consult-booking for what a submission does.
//
// AD TRACKING IS PRODUCTION ONLY. The Meta pixel loads, and the form fires its
// Lead, only in the production build, so a test on localhost or staging never
// reaches the ads account. The server-side Lead has the same rule.

import type { Metadata } from "next"
import { BookingForm } from "./BookingForm"
import { ConsultPixel } from "./ConsultPixel"

export const metadata: Metadata = {
  title: "Book your free consult | Workforce Ready Now",
  description: "Tell us a little about where things stand, then pick a time to talk with Peri.",
}

export default function ConsultPage() {
  const trackLeads = process.env.VERCEL_ENV === "production"
  return (
    <>
      {trackLeads && <ConsultPixel />}
      <BookingForm trackLeads={trackLeads} />
    </>
  )
}
