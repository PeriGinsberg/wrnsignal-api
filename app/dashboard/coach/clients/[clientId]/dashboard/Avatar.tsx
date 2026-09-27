"use client"

// Deterministic avatar matching the My Clients landing palette.
// djb2 hash of name → mod 5 → palette slot. Translucent bg + brighter text.

const PALETTE = [
  // Variables, because these read on navy and vanish on white. The
  // wash is the dark fallback; lib/theme/coachSurface.ts supplies a
  // solid tint and a dark ink for the light ground.
  { bg: "var(--sig-avatar-0-bg, rgba(81,173,229,0.18))", text: "var(--sig-avatar-0-ink, #9FC9EE)" },
  { bg: "var(--sig-avatar-1-bg, rgba(254,176,106,0.18))", text: "var(--sig-avatar-1-ink, #FECDA0)" },
  { bg: "var(--sig-avatar-2-bg, rgba(167,139,250,0.18))", text: "var(--sig-avatar-2-ink, #C8B6F8)" },
  { bg: "var(--sig-avatar-3-bg, rgba(244,114,182,0.18))", text: "var(--sig-avatar-3-ink, #F4ADC9)" },
  { bg: "var(--sig-avatar-4-bg, rgba(74,222,128,0.18))", text: "var(--sig-avatar-4-ink, #9CE7B5)" },
] as const

function hashSlot(input: string): number {
  let h = 5381
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h) + input.charCodeAt(i)
  return Math.abs(h) % PALETTE.length
}

function initials(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name || email || "?").trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function Avatar({
  name,
  email,
  size = 56,
}: {
  name: string | null | undefined
  email?: string | null
  size?: number
}) {
  const seed = (name || email || "?").trim()
  const slot = PALETTE[hashSlot(seed)]
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: slot.bg,
        color: slot.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.max(12, Math.round(size * 0.4)),
        fontWeight: 950,
        letterSpacing: 0.4,
        flexShrink: 0,
      }}
      aria-label={name ? `${name} avatar` : "Client avatar"}
    >
      {initials(name, email)}
    </div>
  )
}
