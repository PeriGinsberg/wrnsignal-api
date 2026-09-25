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
  if (process.env.APP_BASE_URL) return stripTrailingSlash(process.env.APP_BASE_URL)
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  if (req) {
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host")
    if (host) return `https://${host}`
  }
  return "https://wrnsignal-api.vercel.app"
}

function stripTrailingSlash(u: string): string {
  return u.trim().replace(/\/+$/, "")
}

/**
 * Where a client is sent to sign in, for links inside email.
 *
 * APP_BASE_URL IS REQUIRED HERE, AND THE FALLBACK CHAIN ABOVE IS DELIBERATELY
 * NOT USED. getAppUrl() is allowed to guess because its callers render a link
 * inside a page the user is already looking at: if it guesses wrong, they see
 * a broken link and try again. An email is different. It leaves the building,
 * it cannot be corrected, and the wrong guess here is "wrnsignal-api.vercel.app",
 * which is the API host and not a page any client should ever be sent to.
 *
 * So this throws rather than guessing, and the caller records the failure and
 * declines to send. A client who is not emailed can be emailed later from the
 * "Re-send email" button; a client emailed a dead link has already been
 * emailed a dead link.
 */
export function signalLoginUrl(): string {
  const base = process.env.APP_BASE_URL
  if (!base || !base.trim()) {
    throw new Error(
      "APP_BASE_URL is not set, so there is no login page to send the client to. " +
      "Set it on this Vercel environment.",
    )
  }
  return stripTrailingSlash(base)
}
