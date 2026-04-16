import { type NextRequest } from "next/server"
import * as cheerio from "cheerio"
import he from "he"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

// ── User agents ──
const UA_GOOGLEBOT =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
const UA_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

// ── Platform detection ──
type Platform =
  | "linkedin"
  | "indeed"
  | "greenhouse"
  | "lever"
  | "handshake"
  | "workday"
  | "icims"
  | "unknown"

function detectPlatform(hostname: string): Platform {
  const h = hostname.toLowerCase().replace(/^www\./, "")
  if (h === "linkedin.com" || h.endsWith(".linkedin.com")) return "linkedin"
  if (h === "indeed.com" || h.endsWith(".indeed.com") || h === "indeed.app.link") return "indeed"
  if (h === "greenhouse.io" || h.endsWith(".greenhouse.io")) return "greenhouse"
  if (h === "lever.co" || h.endsWith(".lever.co")) return "lever"
  if (h === "joinhandshake.com" || h === "app.joinhandshake.com") return "handshake"
  if (h === "workday.com" || h.endsWith(".workday.com") || h.endsWith(".myworkday.com")) return "workday"
  if (h === "icims.com" || h.endsWith(".icims.com")) return "icims"
  return "unknown"
}

// ── Text cleaning ──
function cleanText(raw: string): string {
  // Strip HTML tags
  const stripped = raw.replace(/<[^>]+>/g, " ")
  // Decode HTML entities
  const decoded = he.decode(stripped)
  // Collapse excess whitespace / newlines
  const collapsed = decoded
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
  return collapsed
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s
}

// ── JSON-LD extraction ──
interface JobPostingJsonLd {
  jobTitle?: string
  title?: string
  hiringOrganization?: { name?: string } | string
  description?: string
  jobLocation?: { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } } | Array<{ address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } }>
  employmentType?: string | string[]
}

function extractJsonLd(html: string): {
  jobTitle: string
  companyName: string
  jobDescription: string
  location: string
  jobType: string
} | null {
  const $ = cheerio.load(html)
  const scripts = $('script[type="application/ld+json"]')

  for (let i = 0; i < scripts.length; i++) {
    const raw = $(scripts[i]).html() || ""
    try {
      const data: JobPostingJsonLd | JobPostingJsonLd[] = JSON.parse(raw)
      const candidates = Array.isArray(data) ? data : [data]

      for (const item of candidates) {
        if ((item as any)["@type"] !== "JobPosting") continue

        const jobTitle = cleanText(item.title || item.jobTitle || "")

        let companyName = ""
        if (typeof item.hiringOrganization === "string") {
          companyName = cleanText(item.hiringOrganization)
        } else if (item.hiringOrganization?.name) {
          companyName = cleanText(item.hiringOrganization.name)
        }

        const jobDescription = truncate(
          cleanText(item.description || ""),
          4000
        )

        let location = ""
        const loc = Array.isArray(item.jobLocation)
          ? item.jobLocation[0]
          : item.jobLocation
        if (loc?.address) {
          const parts = [
            loc.address.addressLocality,
            loc.address.addressRegion,
            loc.address.addressCountry,
          ].filter(Boolean)
          location = parts.join(", ")
        }

        let jobType = ""
        if (Array.isArray(item.employmentType)) {
          jobType = item.employmentType.join(", ")
        } else if (item.employmentType) {
          jobType = item.employmentType
        }

        if (jobTitle || jobDescription) {
          return { jobTitle, companyName, jobDescription, location, jobType }
        }
      }
    } catch {
      // malformed JSON-LD — skip
    }
  }
  return null
}

// ── Platform-specific Cheerio parsers ──

function parseIndeed(
  $: cheerio.CheerioAPI
): { jobTitle: string; companyName: string; jobDescription: string; location: string; jobType: string } {
  const jobTitle = cleanText(
    $("h1.jobsearch-JobInfoHeader-title").first().text() ||
    $('[data-testid="jobsearch-JobInfoHeader-title"]').first().text() ||
    $("h1").first().text()
  )

  const companyName = cleanText(
    $('[data-testid="inlineHeader-companyName"] a').first().text() ||
    $('[data-testid="inlineHeader-companyName"]').first().text() ||
    $(".jobsearch-CompanyInfoContainer").first().text()
  )

  const jobDescription = truncate(
    cleanText(
      $("#jobDescriptionText").html() ||
      $('[data-testid="jobDescriptionText"]').html() ||
      $(".jobsearch-jobDescriptionText").html() ||
      ""
    ),
    4000
  )

  const location = cleanText(
    $('[data-testid="job-location"]').first().text() ||
    $('[data-testid="inlineHeader-companyLocation"]').first().text() ||
    $(".jobsearch-JobInfoHeader-subtitle [data-testid]").last().text()
  )

  const jobType = cleanText(
    $('[data-testid="job-type-display"]').first().text() ||
    $(".jobsearch-JobMetadataHeader-item").first().text()
  )

  return { jobTitle, companyName, jobDescription, location, jobType }
}

function parseGreenhouse(
  $: cheerio.CheerioAPI
): { jobTitle: string; companyName: string; jobDescription: string; location: string; jobType: string } {
  const jobTitle = cleanText(
    $("h1.app-title").first().text() ||
    $("h1.job-title").first().text() ||
    $("h1").first().text()
  )

  // Greenhouse pages often use "Role Title at Company - Greenhouse" in <title>
  let companyName = ""
  const pageTitle = $("title").text()
  const atMatch = pageTitle.match(/\bat\s+(.+?)\s*[-–|]\s*Greenhouse/i)
  if (atMatch) {
    companyName = cleanText(atMatch[1])
  }
  if (!companyName) {
    companyName = cleanText(
      $('[class*="company-name"]').first().text() ||
      $("meta[property='og:site_name']").attr("content") ||
      ""
    )
  }

  const jobDescription = truncate(
    cleanText(
      $("#content").html() ||
      $(".job-description").html() ||
      $('[class*="description"]').html() ||
      ""
    ),
    4000
  )

  const location = cleanText(
    $(".location").first().text() ||
    $('[class*="location"]').first().text() ||
    $(".department-info .location").first().text()
  )

  const jobType = cleanText(
    $('[class*="employment-type"]').first().text() ||
    $('[class*="job-type"]').first().text()
  )

  return { jobTitle, companyName, jobDescription, location, jobType }
}

function parseLever(
  $: cheerio.CheerioAPI
): { jobTitle: string; companyName: string; jobDescription: string; location: string; jobType: string } {
  const jobTitle = cleanText(
    $('h2[data-qa="posting-name"]').first().text() ||
    $("h2.posting-headline").first().text() ||
    $("h2").first().text() ||
    $("h1").first().text()
  )

  const companyName = cleanText(
    $('meta[property="og:site_name"]').attr("content") ||
    $('[class*="company"]').first().text() ||
    ""
  )

  const jobDescription = truncate(
    cleanText(
      $('[data-qa="posting-description"]').html() ||
      $(".posting-description").html() ||
      $('[class*="description"]').html() ||
      ""
    ),
    4000
  )

  const location = cleanText(
    $(".posting-categories .location").first().text() ||
    $('[data-qa="posting-categories"] .location').first().text() ||
    $('[class*="location"]').first().text()
  )

  const jobType = cleanText(
    $(".posting-categories .commitment").first().text() ||
    $('[data-qa="posting-categories"] .commitment').first().text() ||
    $('[class*="work-type"]').first().text()
  )

  return { jobTitle, companyName, jobDescription, location, jobType }
}

function parseHandshake(
  $: cheerio.CheerioAPI
): { jobTitle: string; companyName: string; jobDescription: string; location: string; jobType: string } {
  const jobTitle = cleanText(
    $('[data-hook*="job-title"]').first().text() ||
    $('[data-hook="job-name"]').first().text() ||
    $("h1").first().text()
  )

  const companyName = cleanText(
    $('[data-hook*="employer-name"]').first().text() ||
    $('[data-hook="employer-profile-name"]').first().text() ||
    $('[class*="employer-name"]').first().text()
  )

  const jobDescription = truncate(
    cleanText(
      $('[data-hook*="description"]').html() ||
      $('[data-hook="about-job"]').html() ||
      $('[class*="description"]').html() ||
      ""
    ),
    4000
  )

  const location = cleanText(
    $('[data-hook*="location"]').first().text() ||
    $('[data-hook="job-location"]').first().text() ||
    $('[class*="location"]').first().text()
  )

  const jobType = cleanText(
    $('[data-hook*="job-type"]').first().text() ||
    $('[data-hook*="employment-type"]').first().text() ||
    $('[class*="job-type"]').first().text()
  )

  return { jobTitle, companyName, jobDescription, location, jobType }
}

function parseWorkday(
  $: cheerio.CheerioAPI,
  url: URL
): { jobTitle: string; companyName: string; jobDescription: string; location: string; jobType: string } {
  const jobTitle = cleanText(
    $('[data-automation-id="jobPostingHeader"]').first().text() ||
    $('[data-automation-id="Job_Posting_Title"]').first().text() ||
    $("h2.css-13bxd").first().text() ||
    $("h1").first().text()
  )

  // Extract company from subdomain: acme.wd5.myworkday.com → "acme"
  let companyName = ""
  const subMatch = url.hostname.match(/^([^.]+)\.(?:wd\d+\.myworkday|workday)\.com/)
  if (subMatch) {
    companyName = subMatch[1].replace(/-/g, " ")
  }
  if (!companyName) {
    companyName = cleanText(
      $('meta[property="og:site_name"]').attr("content") ||
      $('[class*="company"]').first().text() ||
      ""
    )
  }

  const jobDescription = truncate(
    cleanText(
      $('[data-automation-id="jobPostingDescription"]').html() ||
      $('[data-automation-id="Job_Description"]').html() ||
      $('[class*="description"]').html() ||
      ""
    ),
    4000
  )

  const location = cleanText(
    $('[data-automation-id="locations"]').first().text() ||
    $('[data-automation-id="job-posting-location"]').first().text() ||
    $('[class*="location"]').first().text()
  )

  const jobType = cleanText(
    $('[data-automation-id="time"]').first().text() ||
    $('[data-automation-id="jobPostingJobSchedule"]').first().text() ||
    $('[class*="job-type"]').first().text()
  )

  return { jobTitle, companyName, jobDescription, location, jobType }
}

function parseIcims(
  $: cheerio.CheerioAPI
): { jobTitle: string; companyName: string; jobDescription: string; location: string; jobType: string } {
  const jobTitle = cleanText(
    $("#header-text h1").first().text() ||
    $(".iCIMS_Header h1").first().text() ||
    $("h1").first().text()
  )

  const companyName = cleanText(
    $('meta[property="og:site_name"]').attr("content") ||
    $(".iCIMS_Logo img").attr("alt") ||
    $('[class*="company"]').first().text() ||
    ""
  )

  const jobDescription = truncate(
    cleanText(
      $(".iCIMS_JobContent").html() ||
      $(".iCIMS_Expandable_Text").html() ||
      $('[class*="job-content"]').html() ||
      ""
    ),
    4000
  )

  const location = cleanText(
    $('[class*="iCIMS_InfoMsg"]').first().text() ||
    $('[class*="location"]').first().text() ||
    $(".iCIMS_Subtitle").first().text()
  )

  const jobType = cleanText(
    $('[class*="job-type"]').first().text() ||
    $('[class*="employment"]').first().text()
  )

  return { jobTitle, companyName, jobDescription, location, jobType }
}

function parseUnknown(
  $: cheerio.CheerioAPI
): { jobTitle: string; companyName: string; jobDescription: string; location: string; jobType: string } {
  // Job title: prefer class-hinted h1, fall back to first h1
  const jobTitle = cleanText(
    $('h1[class*="job-title"]').first().text() ||
    $('h1[class*="jobtitle"]').first().text() ||
    $('h1[class*="posting"]').first().text() ||
    $("h1").first().text()
  )

  const companyName = cleanText(
    $('meta[property="og:site_name"]').attr("content") ||
    $('[class*="company-name"]').first().text() ||
    $('[class*="employer"]').first().text() ||
    ""
  )

  // Description: prefer semantic job containers, fall back to article/main
  const jobDescription = truncate(
    cleanText(
      $('[class*="job-description"]').html() ||
      $('[class*="jobdescription"]').html() ||
      $('[class*="job-details"]').html() ||
      $('[id*="job-description"]').html() ||
      $('[id*="jobDescription"]').html() ||
      $("article").html() ||
      $("main").html() ||
      ""
    ),
    4000
  )

  const location = cleanText(
    $('[class*="location"]').first().text() ||
    $('[class*="job-location"]').first().text() ||
    $('[itemprop="jobLocation"]').first().text()
  )

  const jobType = cleanText(
    $('[class*="job-type"]').first().text() ||
    $('[class*="employment-type"]').first().text() ||
    $('[class*="work-type"]').first().text()
  )

  return { jobTitle, companyName, jobDescription, location, jobType }
}

// ── Claude AI fallback ──
async function claudeFallback(html: string): Promise<{
  jobTitle: string
  companyName: string
  jobDescription: string
  location: string
  jobType: string
} | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  // Strip script/style/nav tags to reduce noise
  const $ = cheerio.load(html)
  $("script, style, nav, header, footer, noscript, iframe, svg").remove()
  const stripped = truncate($.text().replace(/\s{3,}/g, "\n\n").trim(), 6000)

  const prompt = `Extract job posting data from the following page text. Return ONLY valid JSON with these fields:
{
  "jobTitle": "string — the exact job title",
  "companyName": "string — the hiring company name",
  "jobDescription": "string — the full job description text (responsibilities, requirements, qualifications)",
  "location": "string — job location or 'Remote' if applicable",
  "jobType": "string — e.g. Full-time, Part-time, Contract, Internship, or empty string if unknown"
}

If a field cannot be determined, use an empty string. Return only the JSON object, no markdown.

Page text:
${stripped}`

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      }),
    })

    if (!res.ok) {
      console.error("[parse-job-url] Claude fallback API error:", res.status)
      return null
    }

    const json = await res.json()
    const raw = (json.content ?? [])?.[0]?.text ?? ""
    // Strip possible markdown fences
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
    const parsed = JSON.parse(cleaned)

    return {
      jobTitle: cleanText(String(parsed.jobTitle || "")),
      companyName: cleanText(String(parsed.companyName || "")),
      jobDescription: truncate(cleanText(String(parsed.jobDescription || "")), 4000),
      location: cleanText(String(parsed.location || "")),
      jobType: cleanText(String(parsed.jobType || "")),
    }
  } catch (err) {
    console.error("[parse-job-url] Claude fallback parse error:", err)
    return null
  }
}

// ── CORS OPTIONS ──
export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ── POST handler ──
export async function POST(req: NextRequest) {
  let body: { url?: unknown }
  try {
    body = await req.json()
  } catch {
    return withCorsJson(req, { error: "Invalid JSON body", code: "INVALID_URL" }, 400)
  }

  // 1. Validate URL
  let rawUrl = String(body?.url ?? "").trim()
  if (!rawUrl) {
    return withCorsJson(req, { error: "url is required", code: "INVALID_URL" }, 400)
  }

  // Mobile share sheets (especially Indeed) prepend the job title to the URL,
  // e.g. "Marketing Specialisthttps://www.indeed.com/viewjob?jk=xxx".
  // Extract the first http(s) URL and strip surrounding whitespace.
  const urlMatch = rawUrl.match(/https?:\/\/.+/)
  rawUrl = urlMatch ? urlMatch[0].trim() : rawUrl

  // Auto-prepend https:// if no protocol (common on mobile copy-paste)
  if (!/^https?:\/\//i.test(rawUrl)) {
    rawUrl = `https://${rawUrl}`
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    return withCorsJson(req, { error: "Invalid URL format", code: "INVALID_URL" }, 400)
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return withCorsJson(
      req,
      { error: "URL must use http or https", code: "INVALID_URL" },
      400
    )
  }

  // 2. Detect platform
  const platform = detectPlatform(parsedUrl.hostname)
  console.log(`[parse-job-url] platform=${platform} url=${rawUrl}`)

  // 3. LinkedIn path
  if (platform === "linkedin") {
    let html: string | null = null
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10000)
      const res = await fetch(rawUrl, {
        headers: { "User-Agent": UA_GOOGLEBOT },
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (res.ok) html = await res.text()
    } catch (err) {
      console.error("[parse-job-url] LinkedIn fetch error:", err)
    }

    if (html) {
      const ld = extractJsonLd(html)
      if (ld && (ld.jobTitle || ld.jobDescription.length >= 100)) {
        return withCorsJson(req, {
          ...ld,
          source: platform,
          method: "jsonld",
          originalUrl: rawUrl,
        })
      }
    }

    return withCorsJson(
      req,
      {
        error: "LinkedIn limits automated access to job postings",
        code: "LINKEDIN",
        suggestion: "paste_text",
      },
      422
    )
  }

  // 4. All other platforms: fetch with Chrome UA, 10s timeout
  let html: string
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(rawUrl, {
      headers: {
        "User-Agent": UA_CHROME,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      console.error(`[parse-job-url] fetch failed: ${res.status} ${rawUrl}`)
      return withCorsJson(
        req,
        {
          error: `Could not fetch page (HTTP ${res.status})`,
          code: "BLOCKED",
        },
        422
      )
    }

    html = await res.text()
  } catch (err: any) {
    console.error("[parse-job-url] fetch error:", err?.message)
    return withCorsJson(
      req,
      {
        error: "Failed to fetch the job posting URL. The site may block automated access.",
        code: "BLOCKED",
      },
      422
    )
  }

  // 5. Try JSON-LD first
  const ld = extractJsonLd(html)
  if (ld && ld.jobTitle && ld.jobDescription.length >= 100) {
    return withCorsJson(req, {
      ...ld,
      source: platform,
      method: "jsonld",
      originalUrl: rawUrl,
    })
  }

  // 6. Cheerio platform-specific parsing
  const $ = cheerio.load(html)
  let parsed: ReturnType<typeof parseUnknown>

  switch (platform) {
    case "indeed":
      parsed = parseIndeed($)
      break
    case "greenhouse":
      parsed = parseGreenhouse($)
      break
    case "lever":
      parsed = parseLever($)
      break
    case "handshake":
      parsed = parseHandshake($)
      break
    case "workday":
      parsed = parseWorkday($, parsedUrl)
      break
    case "icims":
      parsed = parseIcims($)
      break
    default:
      parsed = parseUnknown($)
      break
  }

  // 7. Claude AI fallback if title empty or description too short
  let method: "cheerio" | "jsonld" | "claude" = "cheerio"

  if (!parsed.jobTitle || parsed.jobDescription.length < 100) {
    console.log(`[parse-job-url] cheerio weak result, trying Claude fallback`)
    const fallback = await claudeFallback(html)
    if (fallback) {
      // Merge: prefer fallback fields for anything that was empty/short
      parsed = {
        jobTitle: parsed.jobTitle || fallback.jobTitle,
        companyName: parsed.companyName || fallback.companyName,
        jobDescription:
          parsed.jobDescription.length >= 100
            ? parsed.jobDescription
            : fallback.jobDescription,
        location: parsed.location || fallback.location,
        jobType: parsed.jobType || fallback.jobType,
      }
      method = "claude"
    }
  }

  // 8. Final validation
  if (parsed.jobDescription.length < 100) {
    return withCorsJson(
      req,
      {
        error: "Could not extract job description from this page",
        code: "PARSE_FAILED",
      },
      422
    )
  }

  return withCorsJson(req, {
    jobTitle: parsed.jobTitle,
    companyName: parsed.companyName,
    jobDescription: parsed.jobDescription,
    location: parsed.location,
    jobType: parsed.jobType,
    source: platform,
    method,
    originalUrl: rawUrl,
  })
}
