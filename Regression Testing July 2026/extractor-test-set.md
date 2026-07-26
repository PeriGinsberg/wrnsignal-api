# Résumé Extractor — Real-Corpus Test Set (§5a + §6 hardening, step 4)

11 real (anonymized) résumés, spanning formats the 8 synthetic golden résumés
never exercised. Each case = résumé + target posting + GROUND TRUTH + the
specific parse-failure it stresses.

**How to score:** run each through the extractor (regex today, LLM after step
2/3), then the detectors. Compare to ground truth. The metric that matters is
FALSE-FIRE — a detector firing on a candidate who genuinely has the evidence,
caused by a parse failure reading it as absent. A parse-fail that reads present
evidence as absent → detector rejects a qualified person = the failure to kill.

**Names/contacts stripped.** Employers kept — they're needed for domain checks
(e.g. Teladoc = health-tech SaaS). Two files excluded (unredacted PII).

Legend:
- SHOULD FIRE = the gap is real; detector firing is CORRECT (true positive).
- MUST NOT FIRE = evidence is present; detector firing = FALSE-FIRE (the bug).

---

## R01 — Ops / Relocation (non-tech)
**Parse stress:** header "PROFESSIONAL EXPERIENCE" (not `### EXPERIENCE`);
dates "May 2023 – Present" (en-dash); ownership verbs "Built and now manage",
"Oversaw", "Led"; CRM tools outside vocab (eRelocation, ReloXchange, Relo
Systems, ProfitPower).

**Target posting:** Operations Coordinator — process/onboarding/CRM admin.
**Ground truth:** QUALIFIED. Real ops experience, real CRM usage, real people
coordination.
**MUST NOT FIRE:** people_mgmt_absent (led/oversaw teams), crm_pipeline_absent
(runs two CRM platforms — but note: these are relocation CRMs, not Salesforce/
HubSpot; if the target names generic "CRM", she has it).
**Extractor must read:** the PROFESSIONAL EXPERIENCE section, the en-dash dates,
"Built and now manage" as ownership.

Résumé:
```
STRATEGIC OPERATIONS PROFESSIONAL | PRECISE, PROCESS-ORIENTED, AND GROWTH-FOCUSED

PROFESSIONAL SUMMARY
Resourceful and highly adaptable professional with experience across operations,
employee onboarding, training program development, compliance, and digital
communications.

CORE COMPETENCIES
Operations Support | Project Coordination | Training & Onboarding | Data Integrity
| Compliance & Audits | Social Media Strategy | CRM & Database Management |
Process Improvement | Cross-Functional Collaboration

PROFESSIONAL EXPERIENCE

Relocation Assistant | Watson Relocation Services - Jacksonville, FL   May 2023 – Present
- Manage and track 20+ real estate referral transactions daily across two CRM platforms (eRelocation, ReloXchange), ensuring accurate updates, file closure, and timely reporting.
- Built and now manage company's social media presence (Instagram, LinkedIn, Facebook), building some platforms from ground up, and responsible for content creation, monthly calendars, and performance tracking using Meta Business Suite Analytics.
- Partner with HR and internal teams supporting corporate relocations, military rebate programs, and agent training.
- Develop training materials and digital modules for relocation agents using Synthesia and Canva.

Professional Development Assistant | Watson School of Real Estate - Jacksonville, FL   Mar 2022 – May 2023
- Coordinated pre-licensing and post-licensing courses for real estate agents, managing instructor schedules, student registrations, and classroom logistics.
- Served as a liaison between newly licensed agents and hiring managers.

Assistant Director, Undergraduate Education Services | Stetson University - Deland, FL   Jul 2021 – Mar 2022
- Oversaw academic compliance and licensing readiness for 200+ Education majors.
- Tracked and reported student progress, coordinated internships, and managed state exam logistics.

Employment Specialist | Florida United Methodist Children's Home - Enterprise, FL   Jun 2020 – Jul 2021
- Led background and compliance process for 250+ employees, volunteers, and contractors across 10+ programs statewide.
- Developed SOPs and training guides to streamline hiring workflows.

TECHNICAL SKILLS
CRM & Platforms: Relo Systems | ProfitPower | Pro Link Plus | Synthesia | Meta Business Suite
Tools: Canva | Microsoft Office (Excel, Outlook, PowerPoint) | Google Workspace | Zoom | Teams
```

---

## R02 — Finance / FIG Analyst (non-tech)
**Parse stress:** dates "Sept 2025 – Present"; ownership verbs "Own private
credit reporting", "Led a team", "Directed", "Mentored analysts"; tools outside
vocab (Bloomberg, PAM, SUN ledger); "$17B" stray number; "ADDITIONAL
EXPERIENCE" packed as one prose line.

**Target A (matched):** Financial analyst — insurance/structured finance.
**Ground truth A:** QUALIFIED. MUST NOT FIRE domain_gap, people_mgmt_absent
(led a team of analysts, mentored), revenue/reporting present.

**Target B (mismatch, true-positive control):** Marketing Analytics Manager,
B2B SaaS (the Threadline-style posting).
**Ground truth B:** domain_gap SHOULD FIRE (genuinely finance, zero SaaS) —
this is a TRUE POSITIVE, confirms the detector still catches a real gap.

**Extractor must read:** "Own private credit reporting" as ownership; "Led a
team of analysts" as management; the $17B as NOT years-of-experience.

Résumé:
```
SUMMARY
Finance analyst with hands-on exposure to a $17B global insurance investment
portfolio spanning private credit, derivatives, and alternatives. Seeking a
Financial Institutions Group or structured finance analyst role.

EDUCATION
Bachelor of Science in Business Management, Concentration in Finance   May 2025
Stony Brook University | Stony Brook, NY | Major GPA: 3.8

EXPERIENCE

Investment Analyst | AWAC Services Company (Fairfax Financial) | New York Metro Area   Sept 2025 – Present
- Analyze and report on a $17B multi-asset portfolio spanning private credit, derivatives, public fixed income, equities, and alternatives across 6 U.S. entities.
- Own private credit reporting (Schedule B) across commercial, residential, and student-housing mortgage portfolios and derivatives reporting (Schedule DB).
- Track private equity and hedge fund limited-partnership positions at cost and market value, booking capital calls and clearing unrealized gains.
- Calculate other-than-temporary impairments (OTTI) in an Excel-based credit-impairment model; reconcile 15+ custodian statements to the PAM asset-management system and SUN general ledger.

Sector Head | Stony Brook University Fourier Fund | Stony Brook, NY   Sept 2024 – May 2025
- Led a team of analysts in sector research for a student-run SRI fund.
- Directed development of equity and fixed-income pitches, conducting valuation and financial modeling.
- Mentored analysts on investment strategy, valuation methods, and long-term portfolio management.

Consultant, Executive in Residence Program | Broadridge Financial Solutions | Stony Brook, NY   Aug 2024 – Dec 2024
- Consulted for a Fortune 500 fintech firm on strategies to optimize wealth-management portfolios.

ADDITIONAL EXPERIENCE
Customer Service Representative / Key Holder, American Community Bank (2022–2023) · Assistant Loan Officer, Jet Direct Funding (2020–2021) · Processing Coordinator, Total Mortgage Services (2018–2020) · Teller II, TD Bank (2016–2018)

SKILLS & CERTIFICATIONS
Analysis & Modeling: DCF valuation, comparable-company analysis, financial modeling, credit analysis
Systems & Tools: Bloomberg, Microsoft Excel (advanced), PAM (asset management), SUN general ledger
Certifications: Bloomberg Market Concepts (BMC)
```

---

## R03 — Data Analyst / Telecom (non-tech)
**Parse stress:** "WORK EXPERIENCE" header; "ACADEMIC EXPERIENCE" as a separate
section; "Summers 2024 – 2025" (non-standard range); contribution-heavy verbs
(Supported, Assisted, Collaborated, Contributed); "September 2017 – Current"
(one role) mixed with "Summers".

**Target posting:** Junior Data Analyst — reporting/Excel/market research.
**Ground truth:** QUALIFIED (entry-level). Uses contribution verbs heavily but
that's honest junior framing — the target is junior, so NOT an ownership demand.
**MUST NOT FIRE:** domain_gap (data analysis present), and NO ownership risk
should fire because the junior posting doesn't demand ownership.
**Extractor must read:** "WORK EXPERIENCE" as the experience section; "Summers
2024 – 2025" as a date range.

Résumé:
```
EDUCATION
Pennsylvania State University – State College, PA
Bachelor of Arts in Telecommunication | Minor in Sports Studies   May 2025

ACADEMIC EXPERIENCE
EV Recycling App – Wireless Communication Industry
- Collaborated on the development of an EV battery recycling app with a focus on user adoption and stakeholder engagement.
- Design solutions for real-time data sharing between EV manufacturers, recycling facilities, and supply chain vendors.

WORK EXPERIENCE

Data Analyst Intern | Main Street Media – Richboro, PA   Summers 2024 – 2025
- Researched and gathered data on potential clients, including company information and decision-makers, resulting in account growth and new client acquisition.
- Compiled and organized data into Excel spreadsheets, streamlining access to critical information for executives.
- Analyzed market trends and lead data, contributing valuable insights that informed business development strategies.

Security Systems Technician Intern | Eagle Eye Video Security – Philadelphia, PA   Summers 2024 – 2025
- Installed, serviced, and repaired security systems at commercial client sites.
- Assisted with troubleshooting and maintenance.
- Collaborated with senior technicians to configure and test security equipment.

Assistant Manager | Zips Dry Cleaners – Warminster, PA   September 2017 – Current
- Supported daily store operations by assisting with workflow coordination, order prioritization, and quality control.
- Maintained accurate order tracking and documentation using proprietary systems.
```

---

## R04 — Law / IP (non-tech)
**Parse stress:** roles with NO date-dash on same line ("StudioIP Denver, CO"
then "Legal Intern   May 2026 – Present" on next line); "Candidate for Juris
Doctor" (enrollment, not degree-held); research tools (Westlaw, LexisNexis);
contribution verbs (Support, Conduct, Assist, Drafted).

**Target posting:** IP / trademark legal intern or junior associate.
**Ground truth:** QUALIFIED. Real IP/litigation experience.
**MUST NOT FIRE:** hard_credential_absent — "Candidate for Juris Doctor" is
enrollment; a JD-in-progress for a law-student role is not a missing credential.
Must NOT read "Candidate for Juris Doctor" as "no degree → credential absent".
**Extractor must read:** the split role/date lines; enrollment ≠ credential gap.

Résumé:
```
EDUCATION
Emory University School of Law   Atlanta, GA
Candidate for Juris Doctor   Expected May 2027
Research Tools: Westlaw, LexisNexis, Midpage AI

Northeastern University   Boston, MA
Bachelor of Arts, cum laude, in Journalism and English   May 2024

EXPERIENCE
StudioIP   Denver, CO
Legal Intern   May 2026 – Present
- Conduct trademark search and clearance analyses and assist with U.S. trademark registration for consumer brands.
- Research and draft legal memoranda and assist in researching, writing, and editing responses to motions across trademark and copyright matters.
- Draft and edit Terms of Service and Privacy Policies for beauty and skincare, healthcare, education, and other consumer-packaged-goods (CPG) clients.

The Office of the DeKalb County Solicitor-General   Decatur, GA
Legal Extern   Jan 2026 – May 2026
- Drafted briefs, memoranda, and motions and conducted legal research for active prosecutions under the supervision of Assistant Solicitors-General.
- Observed multiple bench and jury trials from voir dire through verdict.

The Landau Group   New York, NY
Law Clerk (Freelance)   Aug 2025 – Oct 2025
- Supported plaintiff-side litigation in a copyright-infringement action.
```

---

## R05 — Public Relations (non-tech)
**Parse stress:** nested sub-roles under one employer ("Office Administrator
(2026)", "Assistant Production Manager (2024 & 2025)", "Lead Counselor (2025)"
all under Barclay); "Summers 2023 – 2026"; ownership verbs "Managed", "Drove",
"Grew", "Directed", "Co-led".

**Target posting:** PR / Communications intern.
**Ground truth:** QUALIFIED. Real social/comms work with ownership verbs.
**MUST NOT FIRE:** people_mgmt_absent (directed a 70+ camper program, co-led
recruitment). Extractor must not lose the nested sub-role dates.
**Extractor must read:** the parenthetical-year sub-roles as dated positions.

Résumé:
```
Public relations student pursuing a Summer 2027 PR internship.

EDUCATION
University of Florida, College of Journalism & Communications | Gainesville, FL   Expected May 2028
BS Public Relations | Minor: Theatre | GPA: 3.5

EXPERIENCE

Public Relations Intern | Kanterman Communications Associates | Boca Raton, FL   Jul 2026 – Aug 2026
- Support media relations, client communications, and campaign deliverables for healthcare and pharmaceutical clients.

Social Media Manager | UF Takeover | Gainesville, FL   Sep 2024 – Mar 2025
- Managed all Instagram content for 1,000+ students (2–3 posts/week), using engagement analytics to refine content strategy.
- Drove the company's highest-attended event by building a Greek organization ambassador network and negotiating on-site logistics.

Barclay Performing Arts Theater Company | Boca Raton, FL   Summers 2023 – 2026
Office Administrator (2026)
- Manage front-office operations for the summer camp season.
Assistant Production Manager (2024 & 2025)
- Coordinated end-to-end logistics for 4–5 annual productions with 20+ performers.
Lead Counselor, Summer Mini Camp (2025)
- Directed 6-week summer program for 70+ campers.

LEADERSHIP & CAMPUS INVOLVEMENT
Kappa Alpha Theta | Assistant Recruitment Director (Nov 2025 – Present)
- Co-led Spring Rush securing 8 new pledges from 150+ candidates.
Vice President of Membership | Kulanu Florida   Dec 2025 – Present
- Grew membership 20% through targeted recruitment.

SKILLS & TOOLS
Public Relations: Media Relations | Crisis Communications | Brand Messaging | Campaign Management
Platforms: Instagram | TikTok | LinkedIn | Canva | Adobe Photoshop | Adobe Premiere Pro
```

---

## R06 — Marketing / Business Development (non-tech)
**Parse stress:** date attached to location with no space ("Ithaca, NYExpected
May 2028", "Los Angeles, CA (Remote)Apr 2026 – Present"); contribution +
ownership mix ("Partnered with the VP", "Built a targeted prospect list",
"Maintained").

**Target posting:** Marketing / brand-partnerships analyst.
**Ground truth:** QUALIFIED (entry-level marketing).
**MUST NOT FIRE:** domain_gap for a marketing role (has marketing experience).
**Extractor must read:** the date glued to the location string ("NYExpected",
"(Remote)Apr 2026") — a real formatting break that trips date parsing.

Résumé:
```
SUMMARY
Cornell junior with hands-on marketing and business-development experience
across a sports agency and a media company.

EDUCATION
Cornell University, School of Industrial and Labor Relations | Ithaca, NYExpected May 2028
B.S. in Industrial and Labor Relations, Concentration in Economics | GPA: 3.53

EXPERIENCE

Business Development & Marketing Intern | Premier Athlete Agency, Los Angeles, CA (Remote)Apr 2026 – Present
- Research brands and companies to identify partnership and endorsement opportunities for a roster of 7+ professional athletes, working directly with the agency CEO.
- Analyze market trends and competitor activity to surface brand-partnership opportunities.
- Built a targeted prospect list of corporate sponsors for an international client.

Marketing Intern | City & State Magazine, New York, NY   Jun 2025 – Aug 2025
- Partnered with the VP of Digital Growth to manage and analyze prospect data, driving outreach strategy.
- Maintained and enhanced multi-year datasets used for campaign targeting.

Research Intern | City & State Magazine, New York, NY   Jun 2023 – Aug 2023
- Researched and compiled targeted audience lists and built structured datasets.

SKILLS & TOOLS
Research & Marketing: Market Research | Competitor Analysis | Campaign Targeting | Brand Partnerships
Analytical & Technical: Microsoft Excel | R / RStudio | PowerPoint | Data Analysis | Regression Analysis
```

---

## R07 — Sports / MLB Operations (non-tech)
**Parse stress:** "SKILLS & TOOLS & AFFILIATIONS" combined header; tools with
enrollment caveat "R Studio, Python and SQL (currently enrolled)"; verbs
"Coordinate", "Led", "Supported", "Executed"; "Level 1 - 4" range.

**Target posting:** Baseball / sports operations coordinator.
**Ground truth:** QUALIFIED.
**MUST NOT FIRE:** any tool gate crediting "Python/SQL" as production skills —
they're "(currently enrolled)", i.e. NOT yet held. This tests the reverse: the
extractor must NOT over-credit an in-progress skill as present (false-CLEAR).
**Extractor must read:** "(currently enrolled)" as a not-yet-held qualifier.

Résumé:
```
SUMMARY
Currently part of the San Diego Padres Event Operations team, working towards a
career in Baseball Operations, while pursuing SABR Analytics Certification and
developing analytical skills in Excel, SQL, R, and Python.

EDUCATION
Bachelor of Science, Sport Management | Florida State University | Tallahassee, FL   Dec 2025
Certifications: SABR Analytics Certification (Level 1 - 4) | SABR (currently pursuing)

EXPERIENCE

Event Operations Crew | San Diego Padres | San Diego, CA   Mar 2026 – Present
- Coordinate front-of-house event operations across the full Padres home schedule at Petco Park.
- Selected to mentor new hires after consistently exceeding performance metrics; train incoming crew.

Game Day Representative | Legends & ASM Global (FSU Football) | Tallahassee, FL   Aug 2025 – Nov 2025
- Executed gameday operations for Division I football events serving 60,000+ fans.
- Coordinated vendor and sponsor load-ins.

League Coordinator Intern | Caribbean Baseball Organization | Miami, FL   Feb 2024 – Aug 2024
- Led multi-channel recruitment outreach to high school and college baseball players, building a summer league roster of 50+ players.

SKILLS & TOOLS & AFFILIATIONS
Baseball Operations: Gameday execution | Roster recruitment & onboarding | League scheduling
Tools: Microsoft Excel, Word, PowerPoint | Canva | PCRecruiter | R Studio, Python and SQL (currently enrolled)
```

---

## R08 — Content / Journalism (non-tech)
**Parse stress:** overlapping date ranges (multiple "Present" roles); pipe-
delimited role titles ("Anchor | Reporter | Editor"); ownership verbs "Select",
"Design", "Produced", "Lead", "Grew".

**Target posting:** Social media / content strategy role.
**Ground truth:** QUALIFIED.
**MUST NOT FIRE:** domain_gap (content/social is the domain).
**Extractor must read:** overlapping concurrent roles; pipe-delimited titles.

Résumé:
```
Bilingual content strategist proven on both the brand and newsroom sides.
Seeking a content strategy or social media role with a Miami consumer brand.

EDUCATION
University of Florida, College of Journalism and Communications   Gainesville, FL
B.A. Journalism, Minor in Innovation, Media Sales Certificate   Expected May 2027

EXPERIENCE

News Intern, Assignment Desk Editor | WCJB TV20 & Telemundo Gainesville | Gainesville, FL   May 2026 – Present
- Select, write, and publish approximately 12 web stories per week, deciding which stories run and prioritizing homepage placement.
- Design supporting graphics in Canva and package each story for distribution across Instagram, X, and Facebook.

Content Creator | Dillard's Campus Collective | Gainesville, FL   Jan 2026 – May 2026
- Produced a weekly multi-format content package styling and featuring merchandise.
- Earned Top 5 weekly engagement among ~50 creators twice, including a SKIMS collaboration post that drew 18K+ views.

Content Creator | Gator Chicks (Barstool Sports) & ESPN WRUF | Gainesville, FL   Jun 2026 – Present
- Create social media content and produce tailgate interview videos.

Anchor | Reporter | Editor | WUFT News | Gainesville, FL   Aug 2023 – Present
- Main anchor of the flagship 5 PM newscast for five semesters.

SKILLS
Content & Strategy: Social Media Strategy | Content Calendars | Engagement Analytics | Story Pitching
Production: Adobe Premiere Pro | Lightroom | Final Cut Pro | Canva
```

---

## R09 — Mechanical / Aerospace Engineering (technical, non-software)
**Parse stress:** "ENGINEERING EXPERIENCE" header (not standard); "2024 – 2026"
plain range; ownership verbs "Led", "Machined", "Developed", "Designed", "Grew
AXA from ~5-7 to ~25"; tools MATLAB/Fusion 360/Onshape (eng tools, not the
data-vocab).

**Target posting:** Mechanical / aerospace engineering intern.
**Ground truth:** QUALIFIED. Strong hands-on engineering.
**MUST NOT FIRE:** people_mgmt_absent ("Led payload team", "Grew AXA from ~5-7
to ~25"), domain_gap for an engineering role.
**Extractor must read:** "ENGINEERING EXPERIENCE" as the experience section; the
"~5-7 to ~25" team-growth as management/scope evidence.

Résumé:
```
UF Honors student pursuing dual B.S. degrees in Mechanical and Aerospace
Engineering. Led payload and manufacturing for FAU's first competition rocket.

EDUCATION
University of Florida, Honors Program | Gainesville, FL
B.S. Mechanical Engineering and B.S. Aerospace Engineering
GPA: 4.0/4.0

ENGINEERING EXPERIENCE

Technology and Aerospace Club (TAC), FAU | Boca Raton, FL   2024 – 2026
Payload Team Lead, Manufacturing Lead, and Secretary
- Led payload and manufacturing for FAU's first IREC vehicle, a 10-ft, 63-lb fiberglass rocket; coordinated fabrication, integration, and testing to a 6th-place finish among 140+ international teams.
- Developed LILA, a 3U CubeSat-form-factor environmental-control payload integrating temperature, CO2, light, and pressure sensing.
- Machined all major bulkheads and produced fabrication tooling.

Aerospace Experimental Association (AXA), FAU | Boca Raton, FL   2024 – 2026
Vice President (2025 - 2026) | Secretary (2024 - 2025)
- Contributed to a 6U NASA CubeSat Launch Initiative spacecraft for plant-growth research.
- Led design and integration of a high-altitude-balloon payload bus.
- Grew AXA from ~5-7 to ~25 active multidisciplinary members in one semester; led soldering and Fusion 360 workshops.

TECHNICAL SKILLS
CAD & Analysis: Fusion 360, Onshape, OpenRocket, requirements definition, systems integration, test planning
Manufacturing & Test: FDM 3D printing, manual lathe, CNC mill, soldering, fiberglass/composites
Programming & Tools: MATLAB, C, Arduino/C++, Python, Microsoft Excel
```

---

## R10 — Software Engineer / Full-Stack (TECH — the key false-fire test)
**Parse stress:** LETTER-SPACED title ("S O F T W A R E  E N G I N E E R");
middot-delimited skills ("JavaScript · TypeScript · Python"); employer
**Teladoc Health** = health-tech SaaS but the word "SaaS" NEVER appears; dates
"Jun 2025 – Aug 2025".

**Target posting:** Frontend / full-stack engineer at a B2B SaaS company
(React/Node/TypeScript, ships product dashboards).
**Ground truth:** QUALIFIED. Real SWE at a SaaS company, exact stack match.
**MUST NOT FIRE — this is THE §5a test:** domain_gap. Teladoc is a SaaS/health-
tech product company and this is a real software engineer, but the résumé never
writes "SaaS" or "B2B". A keyword-fitted domain detector would FALSE-FIRE here.
The extractor must infer software/tech domain from the role + employer + stack,
NOT require the literal token "SaaS".
**Also MUST NOT FIRE:** tool gates for React/Node/TypeScript (all in EXPERIENCE).
**Extractor must read:** the letter-spaced title; middot skill delimiters;
Teladoc as a tech/SaaS employer.

Résumé:
```
S O F T W A R E   E N G I N E E R  ·  F R O N T E N D  ·  F U L L S T A C K

EDUCATION
University of Florida, Bachelor of Science in Computer Science   Gainesville, FL
Herbert Wertheim College of Engineering   GPA: 3.70   May 2026

TECHNICAL SKILLS
LANGUAGES: JavaScript · TypeScript · Python · Java · C++ · SQL · HTML/CSS
FRAMEWORKS & LIBRARIES: React · Node.js · Ruby on Rails · MongoDB · GraphQL · Vite · PyTorch · Pandas · NumPy · scikit-learn · Express
TOOLS & PLATFORMS: Docker · Git · GitHub · Supabase · Vercel · Linux/Unix · Agile/Scrum

PROFESSIONAL EXPERIENCE

Teladoc Health · Manhattan, NY   Jun 2025 – Aug 2025
Software Engineering Intern — Clinical Platforms Team
- Developed reusable React and JavaScript UI components for the Provider Performance Navigator — a provider-facing dashboard surfacing clinical performance metrics and weekly schedule insights.
- Configured GitHub repository and local development environment from scratch; built dynamic data visualizations integrated with backend APIs for real-time performance tracking.
- Deployed features using Ruby on Rails and Docker; participated in full Agile sprint cycle with backend engineers, product managers, and UI/UX designers.
- Delivered complete frontend component architecture for the metrics tab.

ACADEMIC PROJECTS
LabSpec Dashboard, Senior capstone — Python · TypeScript · React · Supabase · SQL · Vite
- Full-stack microbiology specimen tracking app built under Agile sprints.
- Architected the Supabase cloud backend (schema design, relational tables, SQL) and connected it to the React frontend.
- Led implementation of a role-based permission system.

TimeSync — React · JavaScript · SQL · Supabase
- Cross-timezone meeting scheduling platform with full calendaring and contact management.
```

---

## R11 — CS / Data & Full-Stack (TECH)
**Parse stress:** "PROFESSIONAL EXPERIENCE" header; ownership verbs "Upgraded",
"Deployed", "Developed", "Managed", "Partnered"; real tools (SQL, Azure,
DBeaver, Cognos, PostgreSQL); "May 2025 – Jul 2025".

**Target posting:** Data analyst / junior software engineer (SQL + full-stack).
**Ground truth:** QUALIFIED. Real SQL/full-stack/cloud work.
**MUST NOT FIRE:** domain_gap (tech), tool gates for SQL/Azure/PostgreSQL (all
in EXPERIENCE, not skills-only). Contrast with synthetic case 05 (Tyler), whose
tools were skills-only — here they're demonstrated in bullets, so they must
read as PRESENT (the symmetric-evidence check, Guard 4).
**Extractor must read:** SQL/Azure/DBeaver as used-in-experience, not skills-only.

Résumé:
```
EDUCATION
The University of Florida | College of Liberal Arts and Science   Gainesville, FL
Bachelor of Science in Computer Science   May 2022 – May 2026
Technical Skills: Microsoft Office Suite | Python | C++ | JavaScript | Express | jQuery | Bootstrap | PostgreSQL | Azure | SFML | HTML | GitHub

PROFESSIONAL EXPERIENCE

City Furniture | Data & Analytics Team Intern – Tamarac FL   May 2025 – Jul 2025
- Upgraded and optimized legacy SQL scripts to align with a new order-tracking system, improving the accuracy and efficiency of order management and supply chain processes.
- Deployed production updates using DBeaver and Cognos, ensuring smooth data integration across multiple business units.
- Partnered with analysts to visualize performance data in Excel, benchmarking team progress against company goals.

Neuberger Berman | Intern – New York, NY   Jun 2023 – Jul 2024
- Developed full-stack web applications with JavaScript, Express, jQuery, Bootstrap, and PostgreSQL to display data for stakeholders.
- Managed application registration and security in Azure, implementing on-prem and cloud solutions including networking, databases, and security.
- Utilized Azure Active Directory for RBAC, VNETs, and OAuth.

L7 Solutions | IT Intern – Sunrise, FL   Jun 2021 – Aug 2021
- Set up and secured computers and user accounts for multiple companies.
- Provided Level 1 tech support, addressing technical issues for 3-4 companies.

PROJECT EXPERIENCE
Full-Stack Development Project
- Developing a JavaScript and HTML-based application with user authentication and dynamic databases.
Minesweeper Game — C++ and SFML
- Coded a Minesweeper game featuring a leaderboard and high-score tracking.
```

---

## Scoring summary — what the run must show

| # | Role | Ground truth | Key assertion |
|---|------|-------------|---------------|
| R01 | Ops | qualified | reads "PROFESSIONAL EXPERIENCE" + en-dash dates; no false mgmt/crm fire |
| R02a | Finance | qualified | no false domain/mgmt fire |
| R02b | Finance→SaaS | **gap real** | domain_gap SHOULD fire (true positive) |
| R03 | Data analyst | qualified | reads "WORK EXPERIENCE" + "Summers" dates |
| R04 | Law | qualified | enrollment ≠ credential; no hard_credential false-fire |
| R05 | PR | qualified | reads nested parenthetical sub-roles; no mgmt false-fire |
| R06 | Marketing | qualified | parses date-glued-to-location |
| R07 | Sports ops | qualified | "(currently enrolled)" NOT credited as skill-held (no false-CLEAR) |
| R08 | Content | qualified | overlapping roles, pipe titles |
| R09 | Aerospace | qualified | "ENGINEERING EXPERIENCE" section; team-growth = mgmt |
| **R10** | **SWE/SaaS** | **qualified** | **domain_gap MUST NOT fire (Teladoc SaaS, word never appears) — THE §5a test** |
| R11 | CS/data | qualified | tools read as in-experience not skills-only (Guard 4) |

**The headline metric:** how many of R01–R11 (excl. R02b) produce a FALSE-FIRE
under the current regex extractor. Each false-fire is a qualified real candidate
the live product would wrongly down-rank. R10 is the sharpest single test.
R02b is the one true-positive that confirms the detector still catches a real gap.
