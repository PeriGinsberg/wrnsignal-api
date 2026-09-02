"use client"

// /dashboard/network/companies — a REDIRECT to the merged page.
//
// THIS ROUTE CAME BACK BECAUSE DELETING IT BROKE FRAMER. The companies board
// was retired when Companies and Contacts became one page, and the deletion
// commit checked that nothing under app/ still linked here. It did not check
// framer/, and the Framer bundle's Networking stop calls
// openDashboard("/dashboard/network/companies") from three call sites: the
// context bar, and both branches of the add-to-networking confirm flow.
//
// So a student on the JobFit side pressing Networking got a browser 404, from
// a grep that was scoped to the wrong tree. The same mistake, in the same
// shape, as scoping a coach-access search to app/api/coach.
//
// A REDIRECT RATHER THAN A FRAMER EDIT, on purpose. It fixes both bundles at
// once with no paste, it fixes bookmarks and any link already sent to a
// student, and it costs one hop. The Framer bundles should still be pointed at
// /dashboard/network directly when they are next touched, at which point this
// file is only carrying old links.
//
// PROD IS NOT BROKEN YET, and would have been on the next promote: production
// still runs the build that has the real companies board, so the prod Framer
// bundle works today by accident of not having been promoted.

import { Suspense, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"

function Redirect() {
  const router = useRouter()
  const sp = useSearchParams()
  useEffect(() => {
    const qs = sp.toString()
    router.replace(qs ? `/dashboard/network?${qs}` : "/dashboard/network")
  }, [router, sp])
  return null
}

export default function CompaniesRedirect() {
  return (
    <Suspense fallback={null}>
      <Redirect />
    </Suspense>
  )
}
