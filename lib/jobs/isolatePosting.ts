// lib/jobs/isolatePosting.ts
//
// Pull the actual job posting out of a pasted web page.
//
// WHY THIS EXISTS. A coach pastes from LinkedIn by selecting the page, not the
// posting, so the text that reaches scoring carries the sidebar, "More jobs for
// you", company insights, the messaging rail and a list of OTHER roles. Every
// one of those is prose about jobs, so the extractor reads it as though it were
// this job. Confirmed on BMO Capital Markets, Analyst, Global Markets Corporate
// Banking: the full-page paste scored a Pass citing "2+ years required" and a
// sales-focused private banking role. Neither claim came from the posting. The
// clean paste of the same role scored 89, Apply.
//
// IT IS NOT A YEARS-PARSING BUG. The years parser reads "0-2 years" as 0
// correctly, and "up to 2 years" as no requirement at all; both are pinned in
// tests/jobs/years-required.test.ts. The "2+ years" was read out of a DIFFERENT
// posting in the sidebar. That distinction decides the fix: tightening the
// parser would have changed nothing, because every number it read was read
// accurately from the text it was handed.
//
// The approach is BOUNDARIES, not blacklists. A blacklist of noise phrases
// cannot keep up with page copy that changes weekly. An opening anchor and a
// closing anchor bound the posting in one move, and whatever sits outside them
// is gone regardless of what it says.

export type IsolationConfidence = "high" | "medium" | "low"

export type IsolatedPosting = {
  /** The text to score. Falls back to the input when nothing could be found. */
  text: string
  confidence: IsolationConfidence
  /** True when the input looked like a pasted PAGE rather than a posting. */
  looksLikePage: boolean
  /** Characters dropped. 0 means the input was returned untouched. */
  removedChars: number
  /** Human-readable, for the confirm step and for logs. */
  reason: string
  /** Which board it looked like, where that was identifiable. */
  source: "linkedin" | "indeed" | "handshake" | "generic" | "none"
}

/**
 * Where a posting STARTS. Board templates put a stable heading immediately
 * before the description, and everything above it is chrome.
 */
const START_ANCHORS: [RegExp, IsolatedPosting["source"]][] = [
  [/^[ \t]*about the job[ \t]*$/im, "linkedin"],
  [/^[ \t]*full job description[ \t]*$/im, "indeed"],
  [/^[ \t]*about the role[ \t]*$/im, "handshake"],
  [/^[ \t]*job description[ \t]*$/im, "generic"],
  [/^[ \t]*role overview[ \t]*$/im, "generic"],
  [/^[ \t]*position summary[ \t]*$/im, "generic"],
  [/^[ \t]*the opportunity[ \t]*$/im, "generic"],
]

/**
 * Where it ENDS. Each of these only ever appears AFTER the description, and
 * each one introduces a list of other people's jobs.
 */
const END_ANCHORS: RegExp[] = [
  /^[ \t]*more jobs for you[ \t]*$/im,
  /^[ \t]*people also viewed[ \t]*$/im,
  /^[ \t]*similar jobs[ \t]*$/im,
  /^[ \t]*jobs you may be interested in[ \t]*$/im,
  /^[ \t]*recommended for you[ \t]*$/im,
  /^[ \t]*explore collaborative articles[ \t]*$/im,
  /^[ \t]*set alert for similar jobs[ \t]*$/im,
  /^[ \t]*company insights?[ \t]*$/im,
  /^[ \t]*view (?:company )?insights?[ \t]*$/im,
  /^[ \t]*report (?:this )?job[ \t]*$/im,
  /^[ \t]*see more jobs[ \t]*$/im,
  /^[ \t]*similar searches[ \t]*$/im,
  /^[ \t]*more searches[ \t]*$/im,
]

/**
 * Markers that say "this is a page, not a posting". These only ever decide
 * CONFIDENCE and whether to ask the human. They never cut text: a posting that
 * happens to contain the word "Messaging" is not chrome.
 */
const PAGE_MARKERS: RegExp[] = [
  /\bmore jobs for you\b/i,
  /\bpeople also viewed\b/i,
  /\beasy apply\b/i,
  /\bskills? match\b/i,
  /\bmeet the hiring team\b/i,
  /\bset alert\b/i,
  /\bsee who .{0,40} has hired\b/i,
  /\bback to search results\b/i,
  /\bhiring lab\b/i,
  /^[ \t]*messaging[ \t]*$/im,
  /^[ \t]*notifications?[ \t]*$/im,
  /^[ \t]*my network[ \t]*$/im,
  /^[ \t]*promoted[ \t]*$/im,
]

/**
 * Lines that are chrome ON THEIR OWN. Applied only inside the kept region, and
 * only to lines that are ENTIRELY one of these, so a posting sentence that
 * mentions applying keeps its sentence.
 */
const CHROME_LINES: RegExp[] = [
  /^(?:easy apply|apply now|apply|save|saved|save job|share|follow|following)$/i,
  /^(?:messaging|notifications?|my network|home|jobs|premium|me|for business|advertise)$/i,
  /^(?:show more|show less|see more|see less|read more)$/i,
  /^(?:promoted|reposted|actively hiring|actively recruiting)$/i,
  /^promoted by hirer\b.*$/i,
  /^\d+\s*(?:minutes?|hours?|days?|weeks?|months?)\s+ago(?:\s*[·|].*)?$/i,
  /^[·•|\s]+$/,
  /^\d+\s+(?:applicants?|people clicked apply)$/i,
  /^(?:posted|reposted)\s+\d+.*$/i,
  // The match widgets LinkedIn injects between the header and the posting.
  // All of these are about the READER, not the job, and several are prose, so
  // they would otherwise be scored as requirements.
  /^\d+\s+notifications?$/i,
  /^link copied to clipboard\.?$/i,
  /^i.m looking for.*$/i,
  /^company logo for,.*$/i,
  /^job match is\b.*$/i,
  /^show match details$/i,
  /^use ai to assess how you fit$/i,
  /^help me update( my profile)?$/i,
  /^tailor my resume$/i,
  /^create cover letter$/i,
  /^your profile and resume\b.*$/i,
  /^see how you compare\b.*$/i,
  // The networking rail, which sits in the same band as the title block and so
  // rides along with the header. It is about the READER's connections, not the
  // job, and on the BRG rows it was enough to push the family classification
  // off Consulting.
  /^help me stand out$/i,
  /^people you can reach out to$/i,
  /^school alumni\b.*$/i,
  /^show all$/i,
  /^\d+$/,
]

/**
 * The page HEADER: the block between the nav and the posting that states the
 * company, the job title, the location and the employment type.
 *
 * KEPT, and this is a correction rather than a nicety. Slicing straight to the
 * posting anchor threw it away, and on the prod corpus that turned
 * location.city "New York City" into null and location.mode "hybrid" into
 * "in_person" on real rows: LinkedIn prints the location in the header and the
 * description below often never repeats it. Those are true facts about THIS
 * job, sitting above the anchor purely because of page layout.
 *
 * Short lines only. The header is made of short labels; the widget prose that
 * sits in the same region runs long, so a length ceiling separates them
 * without needing to enumerate every sentence LinkedIn might write.
 */
const HEADER_MAX_LINE_CHARS = 110
const HEADER_MAX_LINES = 10

/**
 * Where the header STOPS being about the job.
 *
 * Between the title block and the posting, LinkedIn puts the reader's own
 * match score and the recruiter card. The recruiter's name and job title
 * cannot be pattern-matched (they are just words), so the header is cut at the
 * first of these markers and everything after it is dropped wholesale.
 */
const HEADER_STOP: RegExp[] = [
  /^skills? match$/i,
  /^meet the hiring team$/i,
  /^job match is\b/i,
  /^use ai to assess/i,
  /^see how you compare/i,
  /^your profile\b/i,
  /^show match details$/i,
  /^about the job$/i,
]

/**
 * A slice shorter than this is a bad cut rather than a short posting. Real
 * postings run to thousands of characters; anything under a couple of hundred
 * means an anchor matched something that was not the description.
 */
const MIN_POSTING_CHARS = 220

/** The board templates. These strings are page furniture, not JD prose. */
const BOARD_SOURCES = new Set(["linkedin", "indeed", "handshake"])

function findStart(text: string): { index: number; source: IsolatedPosting["source"] } | null {
  // BOARD ANCHORS BEAT GENERIC ONES, whatever the order in the text.
  // "About the job" is LinkedIn's own heading and can only mean one thing;
  // "The Opportunity" is something a JD author writes. Preferring the former
  // stops a page paste from starting at a heading inside the description.
  for (const group of [true, false]) {
    let best: { index: number; source: IsolatedPosting["source"] } | null = null
    for (const [rx, source] of START_ANCHORS) {
      if (BOARD_SOURCES.has(source) !== group) continue
      const m = rx.exec(text)
      if (!m) continue
      const end = m.index + m[0].length
      // Within a group the EARLIEST wins: a page repeats headings inside
      // sidebar cards, and a later one would start the posting halfway
      // through somebody else's.
      if (!best || end < best.index) best = { index: end, source }
    }
    if (best) return best
  }
  return null
}

function findEnd(text: string, from: number): number | null {
  let best: number | null = null
  for (const rx of END_ANCHORS) {
    const m = rx.exec(text)
    if (!m || m.index <= from) continue
    if (best === null || m.index < best) best = m.index
  }
  return best
}

function stripChromeLines(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim()
      if (!t) return true
      return !CHROME_LINES.some((rx) => rx.test(t))
    })
    .join("\n")
    // Collapse the blank runs a stripped nav leaves behind.
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/**
 * Isolate the posting.
 *
 * Never throws and never returns empty: when it cannot find a posting it hands
 * back the input and says so in `reason`, because scoring nothing is worse than
 * scoring noise, and the caller can ask the human instead.
 */
export function isolatePosting(raw: string): IsolatedPosting {
  const input = String(raw ?? "")
  const trimmed = input.trim()

  if (!trimmed) {
    return {
      text: input, confidence: "low", looksLikePage: false,
      removedChars: 0, reason: "Nothing was pasted.", source: "none",
    }
  }

  const looksLikePage = PAGE_MARKERS.some((rx) => rx.test(trimmed))

  // A CLEAN POSTING IS RETURNED UNTOUCHED. Not an optimisation, a correctness
  // gate, and it was added because the first version did not have it: the
  // start anchors include headings like "The Opportunity" and "Job
  // description" that JD authors write inside perfectly clean postings, so
  // without this the isolator sliced the company and title block off the top
  // of ordinary job descriptions. That broke 39 of the 68 core regression
  // cases: companyName "Goldman Sachs" became null and jobTitle became the
  // first bullet of the responsibilities list.
  //
  // So: cut nothing unless something in the text says this came off a page.
  // The markers are the ones no job description would contain, and the cost of
  // missing one is the behaviour we had before, not a worse one.
  if (!looksLikePage) {
    return {
      text: input,
      confidence: "high",
      looksLikePage: false,
      removedChars: 0,
      reason: "Scored the text as pasted.",
      source: "none",
    }
  }

  const start = findStart(trimmed)
  const from = start?.index ?? 0
  const to = findEnd(trimmed, from)
  const source: IsolatedPosting["source"] = start?.source ?? (looksLikePage ? "generic" : "none")

  // The header keeps company / title / location / employment type, which the
  // description below the anchor frequently does not repeat.
  const header = (() => {
    if (!start) return ""
    const lines = stripChromeLines(trimmed.slice(0, start.index))
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && l.length <= HEADER_MAX_LINE_CHARS)
    const stop = lines.findIndex((l) => HEADER_STOP.some((rx) => rx.test(l)))
    const kept = stop >= 0 ? lines.slice(0, stop) : lines
    // The last few, because the nav sits above the title block.
    return kept.slice(-HEADER_MAX_LINES).join("\n")
  })()

  const posting = stripChromeLines(trimmed.slice(from, to ?? undefined))
  const body = header ? `${header}\n\n${posting}` : posting

  // A cut that leaves too little is a bad cut. Hand back the original rather
  // than score a fragment of it.
  if (body.length < MIN_POSTING_CHARS) {
    return {
      text: input,
      confidence: looksLikePage ? "low" : "high",
      looksLikePage,
      removedChars: 0,
      reason: looksLikePage
        ? "This looks like a pasted page, but the posting could not be separated from it. Check the text before scoring."
        : "Scored the text as pasted.",
      source,
    }
  }

  const removedChars = trimmed.length - body.length

  // CONFIDENCE IS ABOUT HOW WELL THE POSTING WAS BOUNDED, not about how much
  // was removed. Both ends found is the only case where the boundaries are
  // known rather than guessed, so on a page paste it is the only "high".
  let confidence: IsolationConfidence
  let reason: string
  if (start && to !== null) {
    confidence = "high"
    reason = `Found the posting between its heading and the section listing other jobs, and removed ${removedChars} characters of page furniture.`
  } else if (start || to !== null) {
    confidence = looksLikePage ? "medium" : "high"
    reason = start
      ? `Found the start of the posting and read to the end of the paste, removing ${removedChars} characters.`
      : `Read from the top of the paste to the section listing other jobs, removing ${removedChars} characters.`
  } else if (looksLikePage) {
    confidence = "low"
    reason = "This looks like a pasted page, but no posting heading was found, so the whole paste would be scored."
  } else {
    confidence = "high"
    reason = removedChars > 0
      ? `Scored the posting, removing ${removedChars} characters of page furniture.`
      : "Scored the text as pasted."
  }

  return { text: body, confidence, looksLikePage, removedChars, reason, source }
}
