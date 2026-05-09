"use client"

// Standalone persona-edit page superseded by the persona section on
// /dashboard (My Account). See app/dashboard/personas/page.tsx header.

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function PersonaEditPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace("/dashboard")
  }, [router])
  return null
}
