// Run: npx tsx lib/ingest/enrichPostings.test.ts
//
// toPatch (lib/ingest/enrichPostings.ts): extractor output -> postings columns
// under 20261029_postings_enrichment_v2.sql. Offline. Cases are the shapes seen
// in the 2026-10-25 Haiku runs on prod postings.

import { EnrichViolation, demoteRejected, postingText, toPatch } from "./enrichPostings"
import type { EnrichFields } from "./enrich"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}
const throws = (fn: () => unknown) => { try { fn(); return false } catch (e) { return e instanceof EnrichViolation } }

const none: EnrichFields = {
  cleaned_title: "Financial Analyst",
  years_min: "not_stated", years_max: "not_stated", years_basis: "not_stated", years_evidence: "",
  graduation_from: null, graduation_to: null, graduation_evidence: "",
  salary_low: "not_stated", salary_high: "not_stated", salary_period: "not_stated", salary_currency: null, salary_evidence: "",
  requirements_summary: null,
  tools: "not_stated", tools_evidence: "",
  level: null, level_evidence: "",
  function: "not_stated", function_evidence: "",
  industry: "not_stated", industry_evidence: "",
  application_deadline: null, deadline_evidence: "",
  employment_types: "not_stated", employment_evidence: "",
  start_type: "not_stated", start_date: null, start_season: null, start_year: null, start_evidence: "",
  campus_signal: false, campus_evidence: "",
  required_majors: "not_stated", majors_basis: "not_stated", majors_evidence: "",
}
const p = (f: Partial<EnrichFields>) => toPatch({ ...none, ...f }, "Financial Analyst - Chicago, IL").patch
const ns = (x: Record<string, unknown>) => (x.enrichment_not_stated as string[]).join(",")

// ── nothing stated: every group named, every value NULL
const empty = p({})
ok("nothing stated names every group", ns(empty) === "years,salary,salary_currency,graduation,application_deadline,requirements_summary,tools,level,employment_type,start,function,industry,majors")
ok("nothing stated: values NULL, cleaned title kept", empty.years_min === null && empty.salary_low === null && empty.deadline_text === null && empty.cleaned_title === "Financial Analyst")
ok("success clears a previous failure", empty.enrichment_failed_at === null && empty.enrichment_error === null)

// ── years
const zero = p({ years_min: 0, years_max: 0, years_basis: "required", years_evidence: "no prior experience required" })
ok("zero is a value, not not-stated", zero.years_min === 0 && zero.years_max === 0 && !ns(zero).includes("years"))
const open = p({ years_min: 3, years_max: "not_stated", years_basis: "required", years_evidence: "3+ years" })
ok("3+ is min 3, max NULL, still stated", open.years_min === 3 && open.years_max === null && open.years_basis === "required" && !ns(open).includes("years"))
ok("preferred basis kept", p({ years_min: 1, years_basis: "preferred", years_evidence: "1+ years considered" }).years_basis === "preferred")
ok("figure with no basis is a violation", throws(() => p({ years_min: 2, years_basis: "not_stated" })))
ok("max below min is a violation", throws(() => p({ years_min: 5, years_max: 2, years_basis: "required" })))
ok("years quote stored as evidence", (open.enrichment_evidence as any).years === "3+ years")

// ── salary
const hourly = p({ salary_low: 25, salary_high: 44, salary_period: "hour", salary_currency: "USD" })
ok("hourly kept hourly", hourly.salary_low === 25 && hourly.salary_high === 44 && hourly.salary_period === "hour")
const exact = p({ salary_low: 90000, salary_high: 90000, salary_period: "year", salary_currency: "USD" })
ok("exact figure: both ends", exact.salary_low === 90000 && exact.salary_high === 90000)
const from = p({ salary_low: 90000, salary_high: "not_stated", salary_period: "year", salary_currency: "USD" })
ok("from $90,000: low only, high NULL, salary stated", from.salary_low === 90000 && from.salary_high === null && !ns(from).split(",").includes("salary"))
const upTo = p({ salary_low: "not_stated", salary_high: 120000, salary_period: "year", salary_currency: "USD" })
ok("up to $120,000: high only, low NULL, salary stated", upTo.salary_low === null && upTo.salary_high === 120000 && !ns(upTo).split(",").includes("salary"))
const noPeriod = p({ salary_low: 63300, salary_high: 114300, salary_period: "not_stated", salary_currency: "USD" })
ok("range with no period: period NULL, salary stated", noPeriod.salary_period === null && !ns(noPeriod).includes("salary,"))
ok("high below low is a violation", throws(() => p({ salary_low: 50, salary_high: 10, salary_period: "hour" })))

// ── graduation
const abs = p({ graduation_from: "2026-12", graduation_to: "2027-06", graduation_evidence: "graduation date of December 2026 through June 2027" })
ok("absolute window stored with its quote", abs.graduation_from === "2026-12" && abs.graduation_to === "2027-06" && String(abs.graduation_text).startsWith("graduation date"))
const rel = p({ graduation_evidence: "Recent graduates are strongly encouraged to apply." })
ok("relative window: text only, still stated", rel.graduation_text !== null && rel.graduation_from === null && !ns(rel).includes("graduation"))
ok("dates with no quote are a violation", throws(() => p({ graduation_to: "2027" })))
ok("bad date format is a violation", throws(() => p({ graduation_from: "Spring 2027", graduation_evidence: "Spring 2027" })))

// ── deadline
const dl = p({ application_deadline: "2026-11-01", deadline_evidence: "The application deadline for this role is November 1, 2026." })
ok("deadline with full date", dl.application_deadline === "2026-11-01" && !ns(dl).includes("application_deadline"))
const noDate = p({ application_deadline: null, deadline_evidence: "Apply by March 1" })
ok("deadline stated without full date: text only", noDate.application_deadline === null && noDate.deadline_text === "Apply by March 1" && !ns(noDate).includes("application_deadline"))
const badDate = p({ application_deadline: "2026-02-30", deadline_evidence: "Apply by Feb 30" })
ok("impossible date dropped, text kept", badDate.application_deadline === null && badDate.deadline_text === "Apply by Feb 30")
ok("date with no quote is a violation", throws(() => p({ application_deadline: "2026-11-01" })))

// ── display-only enums
const r = toPatch({ ...none, function: "Finance and Accounting", function_evidence: "", industry: "Banking", industry_evidence: "a leading regional bank" }, "t")
ok("enum with no quote demoted to not stated", r.patch.function === null && r.patch.function_evidence === null && ns(r.patch).includes("function") && r.demoted.length === 1 && r.demoted[0].field === "function" && r.demoted[0].why === "no_quote")
ok("demotion recorded on the row", JSON.stringify((r.patch.enrichment_evidence as any).demoted) === JSON.stringify(r.demoted))
const off = toPatch({ ...none, industry: "Aerospace" as any, industry_evidence: "a leading aerospace firm" }, "t")
ok("value outside the list demoted, quote dropped", off.patch.industry === null && off.patch.industry_evidence === null && off.demoted[0].why === "not_in_list" && off.demoted[0].value === "Aerospace")
const trading = toPatch({ ...none, function: "Trading", function_evidence: "trades power" }, "t")
const rej = demoteRejected(trading.patch, 'write failed: 23514 new row for relation "postings" violates check constraint "postings_function_known"')
ok("database rejection demotes that field only", !!rej && rej.patch.function === null && rej.patch.function_evidence === null && ns(rej.patch).includes("function") && rej.demotion.why === "rejected_by_database" && rej.demotion.value === "Trading")
ok("rejection recorded on the row", (rej!.patch.enrichment_evidence as any).demoted?.[0]?.value === "Trading")
ok("any other database error is not demoted", demoteRejected(trading.patch, "write failed: 23514 violates check constraint postings_years_shape") === null)
ok("enum with a quote kept", r.patch.industry === "Banking" && r.patch.industry_evidence === "a leading regional bank")

// ── employment type and start timing (added 2026-10-25)
const intern = p({ employment_types: ["internship", "full_time", "internship"], employment_evidence: "Summer internship, full-time hours" })
ok("internship drops full_time, deduped", JSON.stringify(intern.employment_types) === '["internship"]' && !ns(intern).split(",").includes("employment_type"))
const pt = p({ employment_types: ["internship", "part_time"], employment_evidence: "internship, part-time" })
ok("internship keeps part_time", JSON.stringify(pt.employment_types) === '["internship","part_time"]' && !(pt.enrichment_evidence as any).employment_adjusted)
const tp = (title: string, types: EnrichFields["employment_types"]) => toPatch({ ...none, employment_types: types, employment_evidence: "Listed job type: Full-time" }, title).patch
ok("intern title -> internship, not full_time", JSON.stringify(tp("Finance Intern - Summer 2027", ["full_time"]).employment_types) === '["internship"]')
ok("summer analyst title -> internship", JSON.stringify(tp("2027 Investment Banking Summer Analyst", ["full_time"]).employment_types) === '["internship"]')
ok("summer analyst title, not stated -> internship", JSON.stringify(tp("Summer Analyst 2027", "not_stated").employment_types) === '["internship"]')
ok("adjustment recorded", /title states/.test((tp("FP&A Internship", ["full_time"]).enrichment_evidence as any).employment_adjusted))
ok("Internal Audit program stays full_time", JSON.stringify(tp("2027 Internal Audit Analyst Program", ["full_time"]).employment_types) === '["full_time"]')
ok("International title stays full_time", JSON.stringify(tp("International Finance Analyst", ["full_time"]).employment_types) === '["full_time"]')
ok("rotation program the extractor calls full_time stays full_time", JSON.stringify(tp("2027 Finance Rotation Analyst", ["full_time"]).employment_types) === '["full_time"]')
const sDate = p({ start_type: "date", start_date: "2027-06-08", start_evidence: "June 8 - August 14, 2027" })
ok("dated start", sDate.start_type === "date" && sDate.start_date === "2027-06-08" && sDate.start_season === null && sDate.start_text === "June 8 - August 14, 2027" && !ns(sDate).split(",").includes("start"))
const sSeason = p({ start_type: "season", start_season: "summer", start_year: 2027, start_evidence: "Summer 2027 Analyst" })
ok("season start", sSeason.start_type === "season" && sSeason.start_season === "summer" && sSeason.start_year === 2027 && sSeason.start_date === null)
const sNow = p({ start_type: "immediate", start_evidence: "Immediate start" })
ok("immediate start", sNow.start_type === "immediate" && sNow.start_date === null && sNow.start_year === null)
ok("no start: all NULL and 'start' named", empty.start_type === null && empty.start_text === null && ns(empty).split(",").includes("start"))
// Unusable start answers are stored as not stated and recorded, never a failure (2026-10-26).
const unusable = (f: Partial<EnrichFields>) => {
  const r = toPatch({ ...none, ...f }, "t")
  return r.patch.start_type === null && r.patch.start_text === null && ns(r.patch).split(",").includes("start") &&
    r.demoted.length === 1 && r.demoted[0].field === "start" && r.demoted[0].why === "start_unusable" &&
    JSON.stringify((r.patch.enrichment_evidence as any).demoted) === JSON.stringify(r.demoted)
}
ok("start with no quote: not stated, recorded", unusable({ start_type: "immediate", start_evidence: "" }))
ok("impossible start date: not stated, recorded", unusable({ start_type: "date", start_date: "2027-02-30", start_evidence: "Feb 30" }))
ok("season without a year: not stated, recorded", unusable({ start_type: "season", start_season: "summer", start_year: null, start_evidence: "Summer" }))
// The four real failures, as Haiku returned them.
ok("OOS Management: date 'null' -> not stated", unusable({ start_type: "date", start_date: "null", start_evidence: "Start date: TBD" }))
ok("Deloitte 'Summer 2027, Winter 2028' with no season or year -> not stated", unusable({ start_type: "season", start_season: null, start_year: null, start_evidence: "Summer 2027, Winter 2028" }))
const arco = p({ start_type: "season", start_season: null, start_year: 2027, start_evidence: "Construction Project Manager Co-op (Summer/Fall 2027)" })
ok("ARCO 'Summer/Fall 2027', season missing -> earliest named: summer 2027", arco.start_type === "season" && arco.start_season === "summer" && arco.start_year === 2027 && !ns(arco).split(",").includes("start"))
const dd = p({ start_type: "season", start_season: null, start_year: 2026, start_evidence: "AI Research Fellowship, (Summer and Fall 2026)" })
ok("DoorDash 'Summer and Fall 2026' -> summer 2026", dd.start_season === "summer" && dd.start_year === 2026)
const autumn = p({ start_type: "season", start_season: null, start_year: 2027, start_evidence: "Autumn 2027 cohort" })
ok("'Autumn' in the quote reads as fall", autumn.start_season === "fall")

// ── campus signal (added 2026-10-26)
const camp = p({ campus_signal: true, campus_evidence: "2027 Global Private Bank Advisor Program" })
ok("campus true with its quote", camp.campus_signal === true && (camp.enrichment_evidence as any).campus === "2027 Global Private Bank Advisor Program")
ok("campus false stores false, no quote kept", empty.campus_signal === false && !("campus" in (empty.enrichment_evidence as any)))
const noQuote = toPatch({ ...none, campus_signal: true, campus_evidence: "" }, "t")
ok("campus true with no quote is stored false and recorded", noQuote.patch.campus_signal === false && noQuote.demoted.some((d) => d.field === "campus" && d.why === "no_quote"))

// ── tools, title fallback
ok("tools kept", JSON.stringify(p({ tools: ["Excel", "SQL"], tools_evidence: "Excel, SQL" }).tools) === '["Excel","SQL"]')
ok("blank cleaned title falls back to the stored title", p({ cleaned_title: "  " }).cleaned_title === "Financial Analyst - Chicago, IL")

// ── postingText
ok("Google Jobs text from raw.description", postingText("searchapi", { description: "plain text" }) === "plain text")
ok("Greenhouse text from raw.content HTML", postingText("grnhse", { content: "&lt;p&gt;Hello&lt;/p&gt;" }) === "Hello")

// ── required majors (2026-10-26): stored with the quote; no quote or no basis -> not stated
const maj = p({ required_majors: ["Finance", "Economics", "related field"], majors_basis: "required", majors_evidence: "Bachelor's degree in Finance, Economics or a related field" })
ok("majors stored as written, with basis and quote", (maj.required_majors as string[]).join("|") === "Finance|Economics|related field" && maj.majors_basis === "required"
  && (maj.enrichment_evidence as any).majors === "Bachelor's degree in Finance, Economics or a related field")
ok("majors not stated: NULL, named not stated", empty.required_majors === null && empty.majors_basis === null && ns(empty).includes("majors"))
const majNoQuote = toPatch({ ...none, required_majors: ["Accounting"], majors_basis: "required", majors_evidence: "" }, "t")
ok("majors with no quote: stored not stated and recorded", majNoQuote.patch.required_majors === null && majNoQuote.demoted.some((d) => d.field === "majors" && d.why === "no_quote"))
const majNoBasis = toPatch({ ...none, required_majors: ["Accounting"], majors_basis: "not_stated", majors_evidence: "Accounting degree" }, "t")
ok("majors with no basis: stored not stated", majNoBasis.patch.required_majors === null && majNoBasis.patch.majors_basis === null)

console.log(failures ? `\n${failures} failure(s)` : "\nall passed")
if (failures) process.exit(1)
