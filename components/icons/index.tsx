// The SIGNAL icon family.
//
// Source: Redesign0826/signal-icons.md. These are the DESIGNED paths, not
// approximations, transcribed to JSX (hyphenated SVG attributes become camel
// case; everything else is byte-identical to the source).
//
// House rules, from the source file:
//   - one viewBox, 0 0 64 64, so every mark sits on the same grid
//   - rounded, friendly, two-tone, with a spark motif where it fits
//   - colours are HARDCODED, not currentColor. These are brand marks, not
//     tintable UI glyphs, and a two-tone mark cannot inherit one colour anyway.
//   - `size` (default 24) drives width and height together
//
// PEACH INSIDE A GLYPH IS FINE. The exclusivity rule governs buttons and
// interactive surfaces, not decorative fills inside a multi-colour mark: an icon
// is not a button. The one place peach was removed was the company initials
// TILE, because a filled peach rounded square reads as something to press. A pin
// or a card inside an icon does not. See COLOR-SYSTEM.md section 6.9.
//
// Every icon is decorative by default (aria-hidden) because it sits beside its
// own label almost everywhere. Pass a `title` only where a mark stands alone.

type IconProps = {
  size?: number
  title?: string
  style?: React.CSSProperties
}

function Svg({ size = 24, title, style, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      style={{ flexShrink: 0, display: "block", ...style }}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
}

/* ── The 19 core icons ─────────────────────────────────────────────────── */

export function HomeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M32 12 L52 28 v22 a4 4 0 0 1 -4 4 H16 a4 4 0 0 1 -4 -4 V28 z" fill="#51ADE5" />
      <path d="M32 12 L52 28 H12 z" fill="#2B7FB5" />
      <rect x="26" y="38" width="12" height="16" rx="3" fill="#DCFEFF" />
      <circle cx="32" cy="30" r="4" fill="#FEB06A" />
    </Svg>
  )
}

export function ProfileIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="32" cy="32" r="24" fill="#DCFEFF" />
      <circle cx="32" cy="26" r="9" fill="#FEB06A" />
      <path d="M16 50 a16 14 0 0 1 32 0 z" fill="#218C8C" />
    </Svg>
  )
}

export function NetworkIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <line x1="20" y1="24" x2="44" y2="40" stroke="#FEB06A" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="44" y1="22" x2="20" y2="42" stroke="#FEB06A" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="20" cy="24" r="9" fill="#FEB06A" />
      <circle cx="44" cy="22" r="9" fill="#FF8FB0" />
      <circle cx="44" cy="40" r="9" fill="#218C8C" />
      <circle cx="20" cy="42" r="7" fill="#51ADE5" />
    </Svg>
  )
}

export function TrackIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="14" y="20" width="30" height="38" rx="7" fill="#B9E0F5" />
      <rect x="20" y="14" width="30" height="38" rx="7" fill="#51ADE5" />
      <rect x="27" y="24" width="16" height="3.5" rx="1.75" fill="#fff" />
      <rect x="27" y="32" width="16" height="3.5" rx="1.75" fill="#fff" />
      <circle cx="44" cy="44" r="9" fill="#218C8C" />
      <path d="M40 44 l3 3 l5 -6" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  )
}

export function ScoreAJobIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="32" cy="32" r="26" fill="#DCFEFF" />
      <circle cx="32" cy="32" r="17" fill="#6ED0D0" />
      <circle cx="32" cy="32" r="8" fill="#218C8C" />
      <circle cx="32" cy="32" r="3" fill="#fff" />
      <path d="M50 14 L54 10 M52 22 L58 20 M42 12 L44 6" stroke="#FEB06A" strokeWidth="3.5" strokeLinecap="round" />
    </Svg>
  )
}

export function InterviewIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="12" y="16" width="40" height="38" rx="7" fill="#51ADE5" />
      <rect x="12" y="16" width="40" height="11" rx="7" fill="#2B7FB5" />
      <line x1="22" y1="12" x2="22" y2="22" stroke="#13294A" strokeWidth="4" strokeLinecap="round" />
      <line x1="42" y1="12" x2="42" y2="22" stroke="#13294A" strokeWidth="4" strokeLinecap="round" />
      <path d="M32 33 l2.5 6 l6.5 0.6 l-5 4.4 l1.6 6.4 l-5.6 -3.5 l-5.6 3.5 l1.6 -6.4 l-5 -4.4 l6.5 -0.6 z" fill="#FEB06A" />
    </Svg>
  )
}

export function EmailIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="10" y="16" width="44" height="32" rx="8" fill="#51ADE5" />
      <path d="M12 20 L32 36 L52 20" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function TextIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 14 h34 a8 8 0 0 1 8 8 v14 a8 8 0 0 1 -8 8 h-20 l-10 8 v-8 h-4 a8 8 0 0 1 -8 -8 v-14 a8 8 0 0 1 8 -8 z" fill="#218C8C" />
      <circle cx="23" cy="29" r="2.8" fill="#fff" />
      <circle cx="32" cy="29" r="2.8" fill="#fff" />
      <circle cx="41" cy="29" r="2.8" fill="#fff" />
    </Svg>
  )
}

export function RepliedIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14 16 h30 a7 7 0 0 1 7 7 v10 a7 7 0 0 1 -7 7 h-18 l-8 7 v-7 h-4 a7 7 0 0 1 -7 -7 v-10 a7 7 0 0 1 7 -7 z" fill="#DCFEFF" />
      <path d="M28 24 l-7 6 l7 6" fill="none" stroke="#218C8C" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 30 h13 a6 6 0 0 1 6 6 v2" fill="none" stroke="#218C8C" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function QuietIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M40 14 a20 20 0 1 0 12 36 a16 16 0 0 1 -12 -36 z" fill="#FEB06A" />
    </Svg>
  )
}

export function FollowUpIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="32" cy="34" r="22" fill="#FEB06A" />
      <path d="M32 22 v12 l8 5" fill="none" stroke="#13294A" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 10 l-6 5 M44 10 l6 5" stroke="#218C8C" strokeWidth="4" strokeLinecap="round" />
    </Svg>
  )
}

export function HistoryIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="32" cy="32" r="22" fill="#B9E0F5" />
      <circle cx="32" cy="32" r="22" fill="none" stroke="#51ADE5" strokeWidth="3" />
      <path d="M32 20 v12 l9 5" fill="none" stroke="#13294A" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function JobDescriptionIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M18 10 h20 l10 10 v34 a4 4 0 0 1 -4 4 H18 a4 4 0 0 1 -4 -4 V14 a4 4 0 0 1 4 -4 z" fill="#51ADE5" />
      <path d="M38 10 l10 10 h-10 z" fill="#2B7FB5" />
      <rect x="22" y="30" width="20" height="3" rx="1.5" fill="#fff" />
      <rect x="22" y="38" width="20" height="3" rx="1.5" fill="#fff" />
      <rect x="22" y="46" width="13" height="3" rx="1.5" fill="#fff" />
    </Svg>
  )
}

export function NotesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="14" y="12" width="36" height="40" rx="6" fill="#FEB06A" />
      <rect x="21" y="22" width="22" height="3.5" rx="1.75" fill="#fff" />
      <rect x="21" y="30" width="22" height="3.5" rx="1.75" fill="#fff" />
      <rect x="21" y="38" width="14" height="3.5" rx="1.75" fill="#fff" />
      <path d="M46 40 l10 -10 l6 6 l-10 10 l-7 1 z" fill="#218C8C" />
    </Svg>
  )
}

export function AccountIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M32 8 l5 4 l6 -1 l2 6 l6 3 l-2 6 l3 5 l-5 4 l0 6 l-6 1 l-4 5 l-5 -3 l-5 3 l-4 -5 l-6 -1 l0 -6 l-5 -4 l3 -5 l-2 -6 l6 -3 l2 -6 l6 1 z" fill="#51ADE5" />
      <circle cx="32" cy="32" r="9" fill="#DCFEFF" />
    </Svg>
  )
}

export function ResumeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="14" y="10" width="36" height="44" rx="6" fill="#DCFEFF" />
      <rect x="14" y="10" width="36" height="44" rx="6" fill="none" stroke="#51ADE5" strokeWidth="2.5" />
      <circle cx="24" cy="22" r="5" fill="#FEB06A" />
      <rect x="32" y="19" width="12" height="3" rx="1.5" fill="#218C8C" />
      <rect x="32" y="25" width="9" height="3" rx="1.5" fill="#a9c9d8" />
      <rect x="20" y="36" width="24" height="3" rx="1.5" fill="#a9c9d8" />
      <rect x="20" y="43" width="24" height="3" rx="1.5" fill="#a9c9d8" />
    </Svg>
  )
}

export function LocationIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M32 8 c-11 0 -19 8 -19 19 c0 13 19 29 19 29 c0 0 19 -16 19 -29 c0 -11 -8 -19 -19 -19 z" fill="#FEB06A" />
      <circle cx="32" cy="27" r="8" fill="#fff" />
    </Svg>
  )
}

export function CoverLetterIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="12" y="14" width="40" height="30" rx="6" fill="#FEB06A" />
      <path d="M12 18 L32 32 L52 18" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M48 40 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 z" fill="#218C8C" />
    </Svg>
  )
}

export function CoachesHubIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="32" cy="22" r="10" fill="#218C8C" />
      <path d="M14 52 a18 15 0 0 1 36 0 z" fill="#6ED0D0" />
      <path d="M48 10 l1.5 4 l4 1.5 l-4 1.5 l-1.5 4 l-1.5 -4 l-4 -1.5 l4 -1.5 z" fill="#FEB06A" />
    </Svg>
  )
}

/* ── The 7 added marks ─────────────────────────────────────────────────── */

export function CompaniesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="14" y="16" width="22" height="38" rx="4" fill="#51ADE5" />
      <rect x="34" y="26" width="18" height="28" rx="4" fill="#2B7FB5" />
      <rect x="20" y="23" width="5" height="5" rx="1" fill="#fff" />
      <rect x="28" y="23" width="5" height="5" rx="1" fill="#fff" />
      <rect x="20" y="32" width="5" height="5" rx="1" fill="#fff" />
      <rect x="28" y="32" width="5" height="5" rx="1" fill="#fff" />
      <rect x="20" y="41" width="5" height="5" rx="1" fill="#DCFEFF" />
      <rect x="28" y="41" width="5" height="5" rx="1" fill="#DCFEFF" />
      <rect x="40" y="33" width="6" height="5" rx="1" fill="#fff" />
      <rect x="40" y="42" width="6" height="5" rx="1" fill="#DCFEFF" />
      <path d="M25 12 l1.2 3 l3 1.2 l-3 1.2 l-1.2 3 l-1.2 -3 l-3 -1.2 l3 -1.2 z" fill="#FEB06A" />
    </Svg>
  )
}

export function SearchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="28" cy="28" r="15" fill="#DCFEFF" />
      <circle cx="28" cy="28" r="15" fill="none" stroke="#218C8C" strokeWidth="4" />
      <line x1="39" y1="39" x2="52" y2="52" stroke="#218C8C" strokeWidth="6" strokeLinecap="round" />
      <circle cx="28" cy="28" r="6" fill="#6ED0D0" />
    </Svg>
  )
}

export function ImportIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M32 10 v24" stroke="#218C8C" strokeWidth="5" strokeLinecap="round" />
      <path d="M22 26 l10 10 l10 -10" fill="none" stroke="#218C8C" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 40 v8 a4 4 0 0 0 4 4 h28 a4 4 0 0 0 4 -4 v-8" fill="none" stroke="#51ADE5" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M48 12 l1.3 3.4 l3.4 1.3 l-3.4 1.3 l-1.3 3.4 l-1.3 -3.4 l-3.4 -1.3 l3.4 -1.3 z" fill="#FEB06A" />
    </Svg>
  )
}

/** The stepper's DONE state. Teal, matching the stepper's completed colour. */
export function StepCompleteIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="32" cy="32" r="24" fill="#218C8C" />
      <path d="M21 33 l7 7 l15 -16" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

/** A thread that has stopped rather than progressed: no answer, or declined. */
export function StepRestingIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="32" cy="32" r="24" fill="#E9EEF4" />
      <circle cx="32" cy="32" r="24" fill="none" stroke="#D3DCE6" strokeWidth="3" />
      <circle cx="24" cy="32" r="3.5" fill="#8299B3" />
      <circle cx="32" cy="32" r="3.5" fill="#8299B3" />
      <circle cx="40" cy="32" r="3.5" fill="#8299B3" />
    </Svg>
  )
}

/** Attention nudge. Replaces the pin emoji on the Dashboard. */
export function PinIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M32 8 c-11 0 -19 8 -19 19 c0 13 19 29 19 29 c0 0 19 -16 19 -29 c0 -11 -8 -19 -19 -19 z" fill="#FEB06A" />
      <circle cx="32" cy="27" r="8" fill="#fff" />
      <circle cx="32" cy="27" r="3.5" fill="#F0913F" />
    </Svg>
  )
}

/** "This week you're on a roll". Replaces the sprout emoji. */
export function MomentumIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M32 54 V30" stroke="#218C8C" strokeWidth="5" strokeLinecap="round" />
      <path d="M32 34 C32 24 22 20 14 20 C14 30 22 36 32 36 z" fill="#6ED0D0" />
      <path d="M32 30 C32 20 42 15 52 15 C52 26 42 32 32 32 z" fill="#218C8C" />
      <path d="M48 40 l1.3 3.4 l3.4 1.3 l-3.4 1.3 l-1.3 3.4 l-1.3 -3.4 l-3.4 -1.3 l3.4 -1.3 z" fill="#FEB06A" />
    </Svg>
  )
}

export function SignOutIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M30 12 h16 a4 4 0 0 1 4 4 v32 a4 4 0 0 1 -4 4 h-16" fill="none" stroke="#51ADE5" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 32 h22" stroke="#218C8C" strokeWidth="5" strokeLinecap="round" />
      <path d="M26 22 l-12 10 l12 10" fill="none" stroke="#218C8C" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}
