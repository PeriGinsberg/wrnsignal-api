// lib/urls.ts
//
// Environment-aware base URLs for the app and the Framer-hosted site.
// Replaces 13 hardcoded production URLs across routes + client components.
//
// FRAMER_URL: marketing/JobFit Framer site (different host family than the API).
//   - Prod:    https://wrnsignal.workforcereadynow.com
//   - Staging: https://genuine-times-909123.framer.app
//   Configured via NEXT_PUBLIC_FRAMER_URL on each Vercel project.
//
// getAppUrl(req?): this Next.js app (dashboard + API).
//   - Prefers NEXT_PUBLIC_APP_URL (explicit override).
//   - Falls back to the request's x-forwarded-host (Vercel-trusted) so a
//     misconfigured deploy still serves the right host to the user.
//   - Final fallback to the prod URL keeps SSR/non-request contexts safe.
//
// Both vars use NEXT_PUBLIC_ prefix so they inline into the client bundle
// at build time — required for app/dashboard/layout.tsx and tracker/page.tsx.

import type { NextRequest } from "next/server"

export const FRAMER_URL =
  process.env.NEXT_PUBLIC_FRAMER_URL || "https://wrnsignal.workforcereadynow.com"

export function getAppUrl(req?: NextRequest): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  if (req) {
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host")
    if (host) return `https://${host}`
  }
  return "https://wrnsignal-api.vercel.app"
}
