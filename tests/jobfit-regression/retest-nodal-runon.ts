#!/usr/bin/env tsx
// Repro: Jordan Alvarez vs Nodal Exchange event-marketing role.
//
// Prod run c72475ed-5a2d-42b1-8746-768b89d13d50 returned raw_score 88 with
// ZERO why_codes -> evidence guardrail forced Pass @ 55. Six of eight
// requirement_units carried a byte-identical ~1900-char snippet (the whole
// Key Responsibilities block), so every job_fact tripped badJobFact's
// length > 700 filter in selectWhyMatches and was silently discarded.
//
// This script runs the SAME JD twice: once with its newlines intact, once
// with newlines collapsed to spaces (what prod appears to have received).
// That isolates whether splitEvidenceLines fails on paragraph-form JDs only,
// or on this JD generally.

import { runJobFit } from "../../app/api/_lib/jobfitEvaluator"

const JOB_TEXT = `Nodal Exchange, the largest power futures exchange in North America, is a derivatives exchange providing price, credit and liquidity risk management to participants. Nodal Exchange is a leader in innovation, having introduced the world's largest sets of environmental and electric power futures and options contracts.

We are now looking for talented, innovative individuals to join our team in Tyson's Corner, VA (DC Metro area).
Key Responsibilities
Reporting to the Chief Marketing Officer, primary responsibilities include:
Works with and provides strategic and operational support for CMO across many areas of marketing including branding, corporate communications, product marketing, advertising, market research, digital/social marketing - with a particular focus on internal and external events, sustainability projects and reporting, and project management
Collaborate closely with the Marketing Manager to plan, build, and execute end-to-end, multi-channel marketing campaigns related to events
Develop and execute external and internal event plans and strategy for Nodal (~20-25 conference sponsorships, 2-3 receptions, 12-15 internal events)
Manage and coordinate event logistics, creative, and programming for events ranging in size from virtual meetups, to sponsorships & exbibits, to large conferences, to private receptions
Work closely and maintain relationships with agencies, production, staffing, and sponsorship partners
Work cross-functionally with marketing, product & sales teams, EEX Group and collaborating companies to ensure events align with overall business objectives and brand initiatives
Develop creative strategies and experiences that bring events to life including working with vendors to develop creative gifts, favors and promotional giveaways
Provide insights and metrics to understand impact and learnings moving forward
Negotiate investment & contracts with conference producers and venues
Manage supplier management / procurement process in JIRA and track marketing and events expenses, budgets, and forecasts
Support EEX Group and Nodal management in creating, tracking and messaging sustainability and companywide ESG targets
Skills, Knowledge and Expertise
Requirements:
Bachelor's degree or higher in communications, marketing, business administration or related field
Min. 5 years of relevant marketing or business experience
Strong communication skills, including writing and public speaking
Direct contact with customers as well as internal and external stakeholders
Independent, organized, and structured work style
Entrepreneurial mindset
Creative problem solving
High level of reliability of work commitments
Nice to Have:
Experience with creative tools such as Adobe Express, Canva, Constant Contact and / or WordPress
Knowledge of North American or international financial and / or derivatives markets, and our competitive environment
Salary Range: $80,000 - $100,000 per year base salary, when annualized`

const RESUME = `JORDAN ALVAREZ
Chicago, IL | jordan.alvarez@email.com | linkedin.com/in/jordanalvarez

MARKETING ANALYTICS PROFESSIONAL
Data-driven analyst with 5 years driving growth through consumer insights, campaign measurement, and performance reporting.

EXPERIENCE

Senior Marketing Analyst - Northbrook Consumer Group (2023-Present)

    - Supported a 12-person growth marketing team across paid social, search, and CRM for a $400M portfolio of household brands
    - Partnered with media agency to develop quarterly performance dashboards in Tableau; contributed to reporting reviewed by senior leadership
    - Assisted in the rollout of a marketing mix model in collaboration with an external analytics vendor
    - Collaborated cross-functionally with brand, creative, and media teams on campaign readouts

Marketing Analyst - Northbrook Consumer Group (2021-2023)

    - Built recurring reporting on paid media performance across Meta, Google, and retail media networks
    - Helped analyze A/B tests on landing pages and email creative
    - Maintained campaign taxonomy and UTM governance

Marketing Analytics Intern - Halverson Retail (2020-2021)

    - Supported weekly sales and promotion reporting

EDUCATION
BS, Business Analytics - University of Illinois, 2020

SKILLS
SQL, Tableau, Google Analytics 4, Excel, Meta Ads Manager, Google Ads, A/B testing, marketing mix modeling, campaign measurement`

const PROFILE_TEXT = `Name: Jordan Alvarez
Job type: Full-time
Target roles: Marketing Analytics
Target locations: New York City
Timeline: Immediate
Resume Text: ${RESUME}`

const OVERRIDES = {
  targetFamilies: ["Marketing", "Analytics"],
  statedInterests: {
    targetRoles: ["marketing analytics"],
    adjacentRoles: [],
    targetIndustries: ["entertainment"],
  },
  targetRolesRaw: "Marketing Analytics",
} as any

async function runVariant(label: string, jobText: string) {
  const r: any = await runJobFit({
    profileText: PROFILE_TEXT,
    jobText,
    profileOverrides: OVERRIDES,
    userJobTitle: "Senior Marketing Analyst",
    userCompanyName: "Nodal Exchange",
  } as any)

  const units = r.job_signals.requirement_units || []
  const lens = units.map((u: any) => (u.snippet || "").length)
  const over700 = lens.filter((n: number) => n > 700).length
  const uniqueSnippets = new Set(units.map((u: any) => u.snippet)).size

  console.log(`\n=== ${label} ===`)
  console.log("decision:", r.decision, "| score:", r.score, "| raw:", r.score_breakdown.raw_score)
  console.log("why_codes:", r.why_codes.length, "| risk_codes:", r.risk_codes.length)
  console.log(
    `requirement_units: ${units.length} | unique snippets: ${uniqueSnippets} | snippet len max: ${Math.max(0, ...lens)} | over-700: ${over700}`
  )
  console.log("unit keys:", units.map((u: any) => `${u.key}(${(u.snippet || "").length})`).join(", "))
  console.log("requiredTools:", r.job_signals.requiredTools, "| preferredTools:", r.job_signals.preferredTools)
  console.log("risk codes:", r.risk_codes.map((x: any) => `${x.code}:${x.severity}`).join(", "))
  return r
}

async function main() {
  await runVariant("A. JD with newlines intact (as pasted)", JOB_TEXT)
  await runVariant("B. JD with newlines collapsed (paragraph form)", JOB_TEXT.replace(/\s*\n+\s*/g, " "))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
