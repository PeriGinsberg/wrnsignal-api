"use client"

// Deterministic avatar matching the My Clients landing palette.
// djb2 hash of name → mod 5 → palette slot. Translucent bg + brighter text.

const PALETTE = [
  { bg: "rgba(81,173,229,0.18)",  text: "#9FC9EE" },
  { bg: "rgba(254,176,106,0.18)", text: "#FECDA0" },
  { bg: "rgba(167,139,250,0.18)", text: "#C8B6F8" },
  { bg: "rgba(244,114,182,0.18)", text: "#F4ADC9" },
  { bg: "rgba(74,222,128,0.18)",  text: "#9CE7B5" },
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
