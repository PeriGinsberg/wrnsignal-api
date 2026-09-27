// app/dashboard/coach/layout.tsx
//
// Nested route layout for every Coaches Center page. Renders a persistent
// "Coaches Center Beta" banner above the page content, signaling pilot
// status to coaches (and prospective Beta Coaches viewing a demo) and
// framing expectations on polish.
//
// Wraps every route under /dashboard/coach/* automatically via Next.js
// App Router nested-layout inheritance — no per-page wiring needed. The
// parent app/dashboard/layout.tsx still provides the global sidebar nav.
//
// ── THE THEME SEAM ────────────────────────────────────────────────────────
//
// This is also where the Coaches Center decides which palette it is on. Every
// token in `T` is a CSS variable with its dark value as the fallback (see
// lib/theme/coachSurface.ts), so setting --sig-* on this wrapper flips the
// whole subtree and setting nothing leaves it exactly as it was.
//
// COACH_SURFACE is the switch. It is "dark" today: the mechanism ships before
// the repaint, so the change that turns the lights on is one word rather than
// a diff across sixty files, and turning them back off is the same word.
//
// Banner colour: on dark it is WRN Bright Blue #51ADE5 (5.86:1 on T.BG
// #13294A, passing AA normal text; brand navy #1F3A5F was the original spec
// and fails at 1.27:1). On light it takes the structural navy, which is the
// highest-contrast pairing either theme has. See TC-617.

import type { ReactNode } from "react"
import { T } from "../../../lib/dashboard-theme"
import { COACH_SURFACE } from "@/lib/theme/coachSurface"
import { TYPE } from "@/lib/theme/surfaces"


export default function CoachLayout({ children }: { children: ReactNode }) {
  const light = COACH_SURFACE === "light"
  return (
    <div>

      <div
        style={{
          color: T.INK_LINK,
          fontSize: TYPE.title,
          fontWeight: 800,
          letterSpacing: -0.3,
          marginBottom: 24,
          lineHeight: 1.2,
        }}
      >
        Coaches Center Beta
      </div>
      {children}
    </div>
  )
}
