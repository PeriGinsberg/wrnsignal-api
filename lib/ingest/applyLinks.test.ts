// Run: npx tsx lib/ingest/applyLinks.test.ts
//
// Apply link choice (lib/ingest/applyLinks.ts). Cases are Alex's top 25 links
// as checked in a browser on 2026-10-25.

import { chooseApplyLink, chooseMarketLink, classifyLink, linkNamesCity, linksFromRaw } from "./applyLinks"
import { PRESET_CITIES } from "../match/criteria"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}
const pick = (company: string, urls: string[], share: string | null = null) => chooseApplyLink(company, urls.map((url) => ({ url })), share)

ok("employer careers site by host", classifyLink("https://careers.iuhealth.org/jobs/18381697-analyst-financial", "IU Health").kind === "employer")
ok("ATS (Paylocity) is employer", classifyLink("https://recruiting.paylocity.com/recruiting/jobs/Details/4415525/ISG", "ISG Enterprises LLC").kind === "employer")
ok("iCIMS is employer", classifyLink("https://prairiecapitaladvisors-puzzlehr.icims.com/jobs/12483/x/job", "Prairie Capital Advisors").kind === "employer")
ok("Oracle cloud ATS is employer", classifyLink("https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/job/1", "JPMorgan Chase").kind === "employer")
ok("Indeed is a board", classifyLink("https://www.indeed.com/viewjob?jk=1", "Google").kind === "board")
ok("Jobleads is a republisher", classifyLink("https://www.jobleads.com/us/job/x", "Marzetti Company").kind === "republisher")
ok("Vaia (talents subdomain) is a republisher", classifyLink("https://talents.vaia.com/companies/x", "The Industrial Service Group").kind === "republisher")
ok("Nexxt subdomain is a republisher", classifyLink("https://bridgingthegap.nexxt.com/jobs/x.html", "Acxiom").kind === "republisher")
ok("republisher host wins over a company word in its path", classifyLink("https://us.jobrapido.com/worthington-enterprises", "Worthington Enterprises").kind === "republisher")
ok("unknown host is other", classifyLink("https://example-staffing.net/job/1", "Acme").kind === "other")
ok("second word of the name counts (schwabjobs.com)", classifyLink("https://www.schwabjobs.com/job/1", "Charles Schwab").kind === "employer")
ok("two-letter name as a whole host label (jobs.zs.com)", classifyLink("https://jobs.zs.com/jobs/1", "ZS").kind === "employer")
ok("two-letter name not matched inside a word", classifyLink("https://www.zsomething.com/1", "ZS").kind === "other")
ok("generic word does not make an employer (bank)", classifyLink("https://www.bankergigs.com/1", "Bank of America").kind === "other")
ok("board host with the company word is still a board", classifyLink("https://www.linkedin.com/jobs/view/worthington-1", "Worthington Enterprises").kind === "board")
ok("known republisher beats an unknown host", pick("Acme", ["https://zigibugy.tattoo/job/1", "https://www.jobleads.com/us/job/y"])?.kind === "republisher")
ok("whole name run together counts ('Careers At MolsonCoors')", classifyLink("https://jobs.example.net/1", "Molson Coors", "Careers At MolsonCoors").kind === "employer")
ok("'co' inside a word is not stripped as a legal ending", classifyLink("https://molsoncoors.example.net/1", "Molson Coors Co").kind === "employer")
ok("unknown host only when nothing else exists", pick("Acme", ["https://zigibugy.tattoo/job/1"])?.kind === "other")

// #2: only Jobrapido and beBee. Nothing better exists: a republisher, flagged.
const two = pick("Worthington Enterprises, Inc.", ["https://us.jobrapido.com/jobpreview/8504564524563562496", "https://bebee.com/us/jobs/x"])
ok("#2 Worthington: republisher only, kept and flagged", two?.kind === "republisher" && two.url.includes("jobrapido"))

// #22: ZipRecruiter main link, Jobright and beBee in the list -> ZipRecruiter stays.
const z = pick("Worthington Enterprises", ["https://www.ziprecruiter.com/c/Worthington-Enterprises/Job/x", "https://jobright.ai/jobs/info/1", "https://bebee.com/us/jobs/y"])
ok("#22 ZipRecruiter over republishers", z?.kind === "board" && z.url.includes("ziprecruiter"))

// Board order: LinkedIn before Indeed before others, whatever Google's order.
const b = pick("Worthington Enterprises", ["https://www.monster.com/job-openings/x", "https://www.indeed.com/viewjob?jk=1", "https://www.linkedin.com/jobs/view/1", "https://www.jobleads.com/us/job/y"])
ok("LinkedIn first among boards", !!b?.url.includes("linkedin"))

// Employer beats everything, even listed last.
const e = pick("Prairie Capital Advisors", ["https://www.jobleads.com/us/job/a", "https://www.indeed.com/viewjob?jk=2", "https://prairiecapitaladvisors-puzzlehr.icims.com/jobs/12483/x/job"])
ok("employer listed last still wins", e?.kind === "employer" && e.url.includes("icims"))

ok("no links: Google share link, kind google", pick("Acme", [], "https://www.google.com/search?ibp=htl;jobs")?.kind === "google")
ok("nothing at all: null", pick("Acme", []) === null)

// linksFromRaw reads both providers' shapes
const sa = linksFromRaw({ apply_link: "https://a.com/1", via: "Careers At A", apply_links: [{ source: "Indeed", link: "https://indeed.com/2" }] })
ok("SearchApi shape: apply_link then apply_links, with sources", sa.length === 2 && sa[0].source === "Careers At A" && sa[1].url === "https://indeed.com/2")
const sp = linksFromRaw({ apply_options: [{ title: "LinkedIn", link: "https://linkedin.com/1" }] })
ok("SerpApi shape: apply_options", sp.length === 1 && sp[0].source === "LinkedIn")
ok("source label naming the employer counts", chooseApplyLink("Molson Coors", [{ url: "https://jobs.example.net/1", source: "Careers At MolsonCoors" }, { url: "https://www.indeed.com/viewjob?jk=1", source: "Indeed" }])?.kind === "employer")

// the link naming the client's market (Sami's #5, 2026-10-26: the Atlanta requisition was linked when New York was hiring)
const nyc = PRESET_CITIES.nyc
ok("slug names New York", linkNamesCity("https://www.monster.com/job-openings/analyst-new-york-ny--7a6d0da1", nyc))
ok("slug names Philadelphia", linkNamesCity("https://www.jobilize.com/job/us-pa-philadelphia-early-careers-analyst-q5eooja", PRESET_CITIES.philadelphia))
ok("a city inside another word does not count", !linkNamesCity("https://example.com/job/newyorker-analyst", nyc))
const multi = [
  { url: "https://www.linkedin.com/jobs/view/compensation-analyst-atlanta-ga-at-wtw-1", source: "LinkedIn" },
  { url: "https://www.monster.com/job-openings/compensation-analyst-new-york-ny--2", source: "Monster" },
  { url: "https://bebee.com/us/jobs/compensation-analyst-new-york-3", source: "BeBee" },
]
ok("multi-office: the New York link for a NYC client, best kind among them", chooseMarketLink("Willis Towers Watson", multi, nyc)?.url === multi[1].url)
ok("multi-office: no market link for a client elsewhere", chooseMarketLink("Willis Towers Watson", multi, PRESET_CITIES.boston) === null)
ok("no markets: none", chooseMarketLink("Willis Towers Watson", multi, []) === null)
ok("the default choice is unchanged (LinkedIn)", chooseApplyLink("Willis Towers Watson", multi)?.url === multi[0].url)

// Lindsey's review (2026-10-27).
// #1, #6, #9: Handshake needs an account to see the job. A republisher, not a board.
ok("Handshake is a sign-up site, ranked as a republisher", classifyLink("https://app.joinhandshake.com/public/jobs/11381824", "Link Logistics Real Estate").kind === "republisher")
ok("an employer link beats Handshake", chooseApplyLink("Acme Corp", [{ url: "https://app.joinhandshake.com/public/jobs/1" }, { url: "https://careers.acmecorp.com/jobs/1" }])?.kind === "employer")
ok("a board link beats Handshake", chooseApplyLink("Acme Corp", [{ url: "https://app.joinhandshake.com/public/jobs/1" }, { url: "https://www.indeed.com/viewjob?jk=1" }])?.kind === "board")
ok("Handshake alone is still chosen", chooseApplyLink("Acme Corp", [{ url: "https://app.joinhandshake.com/public/jobs/1" }])?.url === "https://app.joinhandshake.com/public/jobs/1")
// #7 Avenue Z: Google merged Claim Health's same-titled job into the listing.
const avenueZ = [
  { url: "https://www.builtinnyc.com/job/content-marketing-intern/11688771", source: "Built In NYC" },
  { url: "https://www.indeed.com/viewjob?jk=e8606f799720b128", source: "indeed.com" },
  { url: "https://www.ycombinator.com/companies/claim-health/jobs/jevdxiH-content-marketing-intern", source: "ycombinator.com" },
  { url: "https://jobs.ashbyhq.com/claim-health/08f325db-b705-4359-b5b9-84d5660ceac6", source: "ashbyhq.com" },
]
ok("Lindsey #7: another company's Ashby account is not Avenue Z's employer link", classifyLink(avenueZ[3].url, "Avenue Z").rank > classifyLink(avenueZ[1].url, "Avenue Z").rank)
ok("Lindsey #7: Indeed is chosen over Claim Health's Ashby page", chooseApplyLink("Avenue Z", avenueZ)?.url === avenueZ[1].url)
ok("an ATS account that names the employer is still first", chooseApplyLink("Avenue Z", [...avenueZ, { url: "https://jobs.ashbyhq.com/avenuez/123", source: "ashbyhq.com" }])?.url === "https://jobs.ashbyhq.com/avenuez/123")
ok("an opaque ATS account is still the employer kind when it is the only link", chooseApplyLink("JPMorgan Chase", [{ url: "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/job/1" }])?.kind === "employer")
// Capital One (Daniel's and Sami's #2): the LinkedIn link is a Clorox job.
const capOne = [
  { url: "https://talents.vaia.com/companies/capital-one/business-analyst-associate-august-2027-136678194/", source: "Talents By Vaia" },
  { url: "https://www.linkedin.com/jobs/view/sales-analyst-recent-grad-summer-2027-start-at-the-clorox-company-4469175642", source: "linkedin.com" },
]
ok("Capital One: a LinkedIn job at the Clorox Company ranks last", classifyLink(capOne[1].url, "Capital one").rank === 400)
ok("Capital One: the Vaia copy of the right job is chosen instead", chooseApplyLink("Capital one", capOne)?.url === capOne[0].url)
ok("a LinkedIn job at the same employer is still a board link", classifyLink("https://www.linkedin.com/jobs/view/business-analyst-at-capital-one-4469175699", "Capital One").kind === "board")
ok("a LinkedIn address without '-at-' is still a board link", classifyLink("https://www.linkedin.com/jobs/view/4469175699", "Capital One").kind === "board")

console.log(failures ? `\n${failures} failure(s)` : "\nall passed")
if (failures) process.exit(1)
