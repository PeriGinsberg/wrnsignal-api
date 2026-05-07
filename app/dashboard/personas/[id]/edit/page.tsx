"use client"

// Persona self-edit is hidden during the Cohort 1 pilot (decision
// 2026-05-07). See app/dashboard/personas/page.tsx for context.
// Restore from git history when re-enabling client self-service.

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function PersonaEditPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace("/dashboard")
  }, [router])
  return null
}
