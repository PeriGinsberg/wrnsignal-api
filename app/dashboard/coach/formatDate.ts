// Long-form date ("Month D, YYYY"), e.g. for "ADDED" / grad date. Extracted
// from prospects/[id]/page.tsx; shared by the prospect + client detail cards.
export function formatDate(iso: string | null): string {
  if (!iso) return ""
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}
