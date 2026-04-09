import {readFileSync} from 'fs';
import {runJobFit} from '../../app/api/_lib/jobfitEvaluator';
import {mapClientProfileToOverrides} from '../../app/api/_lib/jobfitProfileAdapter';

const text = readFileSync('C:/Users/perig/wrnsignal-api/issues/040926ProdIssues.csv','utf8');
const rows: string[][] = [];
let row: string[] = [], cell='', q=false;
for (let i=0;i<text.length;i++){const c=text[i];if(q){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else q=false;}else cell+=c;}else{if(c==='"')q=true;else if(c===','){row.push(cell);cell='';}else if(c==='\n'||c==='\r'){if(cell!==''||row.length>0){row.push(cell);rows.push(row);row=[];cell='';}if(c==='\r'&&text[i+1]==='\n')i++;}else cell+=c;}}
if(cell!==''||row.length>0){row.push(cell);rows.push(row);}
const h = rows[0];
const iC = h.indexOf('Case Number'), iP = h.indexOf('Profile JSON');

// Find Josselyn's profile (first case)
let jossProfile: any = null;
for (let i=1;i<rows.length;i++){
  if (rows[i][iC] === '40926k') {
    const raw = rows[i][iP];
    // tolerant parse
    try { jossProfile = JSON.parse(raw); } catch {
      let depth=0, end=-1;
      for (let k=0;k<raw.length;k++){ if (raw[k]==='[') depth++; else if (raw[k]===']'){depth--; if (depth===0){end=k;break;}}}
      if (end>0) jossProfile = JSON.parse(raw.slice(0,end+1));
    }
    break;
  }
}
const p = Array.isArray(jossProfile) ? jossProfile[0] : jossProfile;
if (!p) { console.error('profile not found'); process.exit(2); }

const profileText = (String(p.profile_text||'').trim() + '\n\nResume:\n' + String(p.resume_text||'').trim()).trim();
const profileOverrides = mapClientProfileToOverrides({
  profileText,
  profileStructured: typeof p.profile_structured === 'string' ? JSON.parse(p.profile_structured||'null') : p.profile_structured,
  targetRoles: p.target_roles || null,
  preferredLocations: p.preferred_locations || null,
});

const jobText = `Senior Manager, Strategy and Business Operations
Miami, FL, United States (On-site)
Job Description
In collaboration and close partnership with leadership across the Fanatics Specialty Businesses Vertical, focused on enabling our integrated platform vison, offers support to our business units in strategy development, operational optimization, select deal negotiations, and explores growth opportunities in new verticals that are important to the sports fan. This role is extremely high visible across the organization and provides high strategic, transactional, and operational exposure.

What You'll Do:
Develop compelling presentations that transform complex data and analysis into clear and concise narratives for senior internal and external executives
Research and analyze market trends, competitor strategies, and industry dynamics to identify insights on how it impacts Fanatics' businesses
Build and maintain financial models to assess the financial impact of strategic initiatives
Project management of certain initiatives from start to finish
Analyze cross-platform key performance indicators and operational metrics to evaluate business performance and identify areas of opportunities
Manage competing priorities & provide level-headed guidance during unexpected events
This job will require occasional travel.

What We're Looking For:
3 - 5 years relevant experience in a Management Consulting or Financial Analyst/Associate role within top advisory firm or bank
Experience demonstrating problem solving and root cause analysis coupled with ability to collect relevant information, analyze, and "connect the dots" to facilitate collaboration across different parts of the business
Highly analytical, detail oriented and strong business sense; proven ability to develop new ideas / creative solutions and demonstrated experience implementing those solutions
Demonstrated financial acumen and/or analytical experience including familiarity with concepts of forecasting, valuations, and/or data interpretation and analysis
Expertise using Excel and PowerPoint to analyze data and drive business insights
Insightful, consistent, and considerate communication skills, both verbal and written
Ability to meet tight deadlines, prioritize workload and achieve effective results in a fast-paced, dynamic, ever-growing and often ambiguous environment; effective multi-tasking skills are vital
Familiarity and fluency with company reporting documents and public filings
Team player with the ability to develop relationships at various levels internally and externally, and champion our company culture
Strong work ethic with a sense of urgency to resolve issues promptly
Comfortable managing the strategic aspects as well as the tactical details of the business
Natural curiosity and drive, with a proactive approach toward what may make sense even if not specifically requested
Maturity to handle sensitive information and manage dialogues at the highest level of the organization
Interest in sports and/or entertainment business models is preferable, but not a must
Location: Miami / Fort Lauderdale, FL area

About Us
Fanatics is building a leading global digital sports platform. We ignite the passions of global sports fans and maximize the presence and reach for our hundreds of sports partners globally by offering products and services across Fanatics Commerce, Fanatics Collectibles, and Fanatics Betting & Gaming.
`;

async function main() { const result: any = await runJobFit({
  profileText,
  jobText,
  profileOverrides,
  userJobTitle: 'Senior Manager, Strategy and Business Operations',
  userCompanyName: 'Fanatics',
} as any);

console.log('\n=== ISSUE-026 Retest ===');
console.log('Decision:', result.decision, '/ Score:', result.score);
console.log('Gate:', result.gate_triggered?.type);
console.log('Job family:', result.job_signals.jobFamily);
console.log('Profile targetFamilies:', result.profile_signals.targetFamilies);
console.log('isSeniorRole:', result.job_signals.isSeniorRole);
console.log('yearsRequired:', result.job_signals.yearsRequired);
console.log('profileYears:', result.profile_signals.yearsExperienceApprox);
console.log('functionTags:', result.job_signals.function_tags);
console.log('\nWHY codes (' + (result.why_codes||[]).length + '):');
for (const w of (result.why_codes||[])) console.log('  ['+w.code+']', w.match_key, '('+w.match_strength+', w='+w.weight+')', '\n    job:', String(w.job_fact||'').slice(0,140), '\n    prof:', String(w.profile_fact||'').slice(0,140));
console.log('\nRISK codes (' + (result.risk_codes||[]).length + '):');
for (const r of (result.risk_codes||[])) console.log('  ['+r.code+'] sev='+r.severity+' w='+r.weight+'\n    ', String(r.risk||'').slice(0,200));

}
main();
