/**
 * One name per tool.
 *
 * WHY THIS EXISTS. The three-run stability check found the extractor returning
 * the SAME tools under different names from the identical quote: "Computer
 * skills: proficiency using Word, Excel, Outlook and Microsoft Project" came
 * back as ["Word", "Excel", "Outlook", "Microsoft Project"] on one run and
 * ["Microsoft Word", "Microsoft Excel", "Microsoft Outlook", "Microsoft
 * Project"] on the next. That is not disagreement about what the posting says,
 * it is disagreement about what to call it, and it was 2 of the 3 tools
 * disagreements measured.
 *
 * Unfixed, it breaks matching in the quietest possible way: a candidate with
 * "Excel" would not match a posting stored as "Microsoft Excel", and nothing
 * would look wrong. Prompting alone cannot fix it, because the run-to-run
 * variance is in the model and temperature cannot be set on this model.
 *
 * STRIPPING THE VENDOR IS NOT ALWAYS SAFE, which is the whole difficulty.
 * "Google Analytics" and "Adobe Analytics" are different products that both
 * strip to "Analytics", and "Copilot" is ambiguous between Microsoft and
 * GitHub. So the vendor is stripped only when what remains still names the
 * product on its own; when it does not, the vendor is part of the name and
 * stays. KEEP_VENDOR is that list, and it is the safety rail: a word added
 * there can only ever preserve a distinction, never lose one.
 */

/** Vendor words that are droppable when the remainder still names the product. */
const VENDOR_PREFIXES = [
  "microsoft",
  "ms",
  "google",
  "adobe",
  "amazon",
  "oracle",
  "ibm",
  "apache",
  "salesforce",
  "atlassian",
  "meta",
  "facebook",
  "sap",
  "intuit",
]

/**
 * Remainders that do NOT name a product on their own, so the vendor stays.
 * Each entry is a distinction that stripping would destroy.
 */
const KEEP_VENDOR = new Set([
  "analytics",   // Google Analytics vs Adobe Analytics
  "ads",         // Google Ads vs Meta Ads
  "ad manager",
  "cloud",       // Google Cloud vs IBM Cloud vs Oracle Cloud
  "copilot",     // Microsoft Copilot vs GitHub Copilot
  "fabric",      // Microsoft Fabric vs Fabric.js vs HashiCorp tooling
  "project",     // "Project" alone is unreadable in a tools list
  "search",
  "search console",
  "docs",
  "drive",
  "sheets",
  "slides",
  "forms",
  "studio",
  "suite",
  "workspace",
  "office",
  "platform",
  "calendar",
  "maps",
  "meet",
  "chat",
  "one",
  "business intelligence",
  "data studio",
  "tag manager",
])

/**
 * Names that prefix-stripping cannot reconcile: abbreviations, punctuation
 * variants, and products whose common name is not the formal one.
 * Keys are lowercased; values are the stored spelling.
 */
const ALIASES = new Map<string, string>([
  ["excel", "Excel"],
  ["msexcel", "Excel"],
  ["word", "Word"],
  ["msword", "Word"],
  ["outlook", "Outlook"],
  ["powerpoint", "PowerPoint"],
  ["power point", "PowerPoint"],
  ["ppt", "PowerPoint"],
  ["teams", "Teams"],
  ["office 365", "Microsoft Office"],
  ["o365", "Microsoft Office"],
  ["m365", "Microsoft Office"],
  ["microsoft 365", "Microsoft Office"],
  ["microsoft office suite", "Microsoft Office"],
  ["sql server", "SQL Server"],
  ["t-sql", "SQL"],
  ["tsql", "SQL"],
  ["power bi", "Power BI"],
  ["powerbi", "Power BI"],
  ["power-bi", "Power BI"],
  ["power platform", "Power Platform"],
  ["power automate", "Power Automate"],
  ["power apps", "Power Apps"],
  ["powerapps", "Power Apps"],
  ["aws", "AWS"],
  ["amazon web services", "AWS"],
  ["gcp", "Google Cloud Platform"],
  ["google cloud platform", "Google Cloud Platform"],
  ["google cloud", "Google Cloud Platform"],
  ["bigquery", "BigQuery"],
  ["big query", "BigQuery"],
  ["d365", "Dynamics 365"],
  ["d365 fo", "Dynamics 365 Finance & Operations"],
  ["d365 f&o", "Dynamics 365 Finance & Operations"],
  ["dynamics 365 finance and operations", "Dynamics 365 Finance & Operations"],
  ["dynamics 365 finance & operations", "Dynamics 365 Finance & Operations"],
  ["dynamics 365 for finance and operations", "Dynamics 365 Finance & Operations"],
  ["sfdc", "Salesforce"],
  ["gsheets", "Google Sheets"],
  ["g suite", "Google Workspace"],
  ["gsuite", "Google Workspace"],
  ["sa360", "Search Ads 360"],
  ["search ads 360", "Search Ads 360"],
  ["dv360", "Display & Video 360"],
  ["ga4", "Google Analytics"],
  ["js", "JavaScript"],
  ["javascript", "JavaScript"],
  ["typescript", "TypeScript"],
  ["node", "Node.js"],
  ["nodejs", "Node.js"],
  ["node js", "Node.js"],
  ["postgres", "PostgreSQL"],
  ["postgresql", "PostgreSQL"],
  ["k8s", "Kubernetes"],
  ["jira", "Jira"],
  ["confluence", "Confluence"],
  ["looker", "Looker"],
  ["tableau", "Tableau"],
  ["figma", "Figma"],
  ["python", "Python"],
  ["sql", "SQL"],
  ["r", "R"],
  ["azure devops", "Azure DevOps"],
  ["ado", "Azure DevOps"],
  ["sharepoint", "SharePoint"],
  ["yardi", "Yardi"],
])

/** Trailing noise the model sometimes appends. */
const TRAILING = /[\s.,;:!?]+$|\s*\((?:preferred|a plus|optional|nice to have)\)$/gi

function tidy(raw: string): string {
  return String(raw ?? "")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .replace(TRAILING, "")
    .trim()
}

/**
 * The stored name for one tool.
 *
 * Unknown tools pass through with only whitespace tidied. This function
 * normalizes names it recognizes; it does NOT decide what counts as a tool, and
 * it must never drop one it does not know.
 */
export function canonicalTool(raw: string): string {
  const cleaned = tidy(raw)
  if (!cleaned) return ""

  const direct = ALIASES.get(cleaned.toLowerCase())
  if (direct) return direct

  for (const vendor of VENDOR_PREFIXES) {
    const prefix = vendor + " "
    if (cleaned.toLowerCase().startsWith(prefix)) {
      const rest = cleaned.slice(prefix.length).trim()
      if (!rest) break
      // The vendor is load-bearing for this product: keep the full name.
      if (KEEP_VENDOR.has(rest.toLowerCase())) break
      const aliased = ALIASES.get(rest.toLowerCase())
      return aliased ?? rest
    }
  }

  return cleaned
}

/**
 * Canonicalize a list, dropping blanks and duplicates.
 *
 * Order is first-seen rather than sorted: the posting's own emphasis is worth
 * keeping, and de-duplication already makes two runs with the same tools in a
 * different order compare equal as a set.
 */
export function canonicalTools(raw: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of raw) {
    const c = canonicalTool(t)
    if (!c) continue
    const k = c.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(c)
  }
  return out
}
