// A client's SOW, from the private link in their email. No login. Kept out of
// search engines. The page itself is ./SowLinkPage.tsx.

import type { Metadata } from "next"
import { SowLinkPage } from "./SowLinkPage"

export const metadata: Metadata = {
  title: "Your Statement of Work | Workforce Ready Now",
  robots: { index: false, follow: false },
}

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <SowLinkPage token={token} />
}
