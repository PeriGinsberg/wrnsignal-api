import { NextResponse } from "next/server"

export async function GET() {
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SIGNAL Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#060e1c;color:#fff;min-height:100vh;padding:20px;}
.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;}
.logo{font-size:20px;font-weight:900;letter-spacing:1px;}
.logo span{color:#FEB06A;}
.refresh-btn{background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.7);font-size:12px;padding:7px 14px;border-radius:20px;cursor:pointer;letter-spacing:1px;text-transform:uppercase;}
.refresh-btn:hover{background:rgba(255,255,255,0.14);}
.last-updated{font-size:11px;color:rgba(255,255,255,0.3);margin-top:4px;text-align:right;}

.metrics{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px;}
@media(min-width:600px){.metrics{grid-template-columns:repeat(5,1fr);}}
.metric{background:#0f1f38;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:16px;}
.metric-label{font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.30);margin-bottom:8px;}
.metric-value{font-size:32px;font-weight:700;line-height:1;}
.metric-sub{font-size:11px;color:rgba(255,255,255,0.35);margin-top:5px;}
.blue{color:#51ADE5;} .green{color:#4AE888;} .orange{color:#FEB06A;} .red{color:#EF4444;} .white{color:#fff;}

.grid2{display:grid;grid-template-columns:1fr;gap:12px;margin-bottom:12px;}
@media(min-width:600px){.grid2{grid-template-columns:1fr 1fr;}}

.card{background:#0f1f38;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:18px;}
.card-title{font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.30);margin-bottom:16px;}

.funnel{display:flex;flex-direction:column;gap:8px;}
.funnel-row{display:flex;align-items:center;gap:10px;}
.funnel-label{font-size:12px;color:rgba(255,255,255,0.55);width:140px;flex-shrink:0;}
.funnel-bar-wrap{flex:1;background:rgba(255,255,255,0.06);border-radius:3px;height:24px;overflow:hidden;}
.funnel-bar{height:100%;border-radius:3px;display:flex;align-items:center;padding-left:8px;min-width:32px;transition:width 0.8s ease;}
.funnel-bar span{font-size:11px;font-weight:600;color:#fff;white-space:nowrap;}
.funnel-pct{font-size:12px;font-weight:600;width:42px;text-align:right;flex-shrink:0;}

.source-list{display:flex;flex-direction:column;gap:10px;}
.source-row{display:flex;align-items:center;gap:8px;}
.source-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
.source-name{font-size:12px;color:rgba(255,255,255,0.55);flex:1;}
.source-bar-wrap{width:70px;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;}
.source-bar{height:100%;border-radius:2px;transition:width 0.8s ease;}
.source-count{font-size:13px;font-weight:600;width:24px;text-align:right;}

.events-list{display:flex;flex-direction:column;}
.event-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.05);}
.event-row:last-child{border-bottom:none;}
.event-time{font-size:11px;color:rgba(255,255,255,0.30);width:54px;flex-shrink:0;}
.event-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;}
.event-name{font-size:12px;color:rgba(255,255,255,0.70);flex:1;}
.event-badge{font-size:9px;font-weight:700;letter-spacing:1px;padding:3px 8px;border-radius:10px;text-transform:uppercase;}
.badge-green{background:rgba(74,232,136,0.12);color:#4AE888;}
.badge-blue{background:rgba(81,173,229,0.12);color:#51ADE5;}
.badge-orange{background:rgba(254,176,106,0.12);color:#FEB06A;}
.badge-red{background:rgba(239,68,68,0.12);color:#EF4444;}
.badge-purple{background:rgba(127,119,221,0.12);color:#7F77DD;}

.card-sub{font-size:11px;color:rgba(255,255,255,0.30);margin-top:-10px;margin-bottom:16px;line-height:1.5;}
.loading{color:rgba(255,255,255,0.30);font-size:13px;text-align:center;padding:20px;}
.journey-row{display:flex;align-items:center;gap:6px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);}
.journey-row:last-child{border-bottom:none;}
.journey-step{font-size:10px;font-weight:700;letter-spacing:0.5px;padding:3px 8px;border-radius:8px;white-space:nowrap;}
.journey-arrow{color:rgba(255,255,255,0.15);font-size:10px;}
.journey-time{font-size:10px;color:rgba(255,255,255,0.22);margin-left:auto;white-space:nowrap;}
.hour-row{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.04);}
.hour-row:last-child{border-bottom:none;}
.hour-label{font-size:12px;color:rgba(255,255,255,0.35);width:50px;flex-shrink:0;font-weight:600;}
.hour-pills{display:flex;flex-wrap:wrap;gap:4px;flex:1;}
.hour-pill{font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;}
.eng-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;}
@media(min-width:600px){.eng-grid{grid-template-columns:repeat(4,1fr);}}
.eng-box{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px;text-align:center;}
.eng-num{font-size:28px;font-weight:700;line-height:1;}
.eng-label{font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,0.30);margin-top:6px;}
.eng-sub{font-size:11px;color:rgba(255,255,255,0.25);margin-top:3px;}
.empty{color:rgba(255,255,255,0.25);font-size:12px;text-align:center;padding:16px;}

.verdict-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}
.verdict-pill{border-radius:10px;padding:12px 8px;text-align:center;}
.verdict-pill.pa{background:rgba(15,214,104,0.08);border:1px solid rgba(15,214,104,0.25);}
.verdict-pill.ap{background:rgba(74,232,136,0.07);border:1px solid rgba(74,232,136,0.20);}
.verdict-pill.rv{background:rgba(254,176,106,0.08);border:1px solid rgba(254,176,106,0.22);}
.verdict-pill.ps{background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.20);}
.vp-label{font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:5px;}
.pa .vp-label{color:#0FD668;} .ap .vp-label{color:#4AE888;} .rv .vp-label{color:#FEB06A;} .ps .vp-label{color:#EF4444;}
.vp-num{font-size:24px;font-weight:700;}

.date-tabs{display:flex;gap:6px;margin-bottom:16px;}
.date-tab{font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:6px 14px;border-radius:20px;cursor:pointer;border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.40);}
.date-tab.active{background:rgba(81,173,229,0.15);border-color:rgba(81,173,229,0.35);color:#51ADE5;}
</style>
</head>
<body>

<div class="header">
  <div>
    <div class="logo">SIGNAL<span>—</span></div>
    <div style="font-size:11px;color:rgba(255,255,255,0.30);margin-top:2px;">Growth Dashboard</div>
  </div>
  <div style="text-align:right;">
    <button class="refresh-btn" onclick="loadAll()">↺ Refresh</button>
    <div class="last-updated" id="last-updated">Loading...</div>
  </div>
</div>

<div class="date-tabs">
  <div class="date-tab" onclick="setRange(1,this)">Today</div>
  <div class="date-tab" onclick="setRange(7,this)">7 Days</div>
  <div class="date-tab" onclick="setRange(30,this)">30 Days</div>
  <div class="date-tab active" onclick="setRange(999,this)">All Time</div>
</div>

<div class="metrics">
  <div class="metric">
    <div class="metric-label">Landing Page Visitors</div>
    <div class="metric-value blue" id="m-landing">—</div>
    <div class="metric-sub">Unique visitors to /signal</div>
  </div>
  <div class="metric">
    <div class="metric-label">Job Analysis Page Views</div>
    <div class="metric-value blue" id="m-visitors">—</div>
    <div class="metric-sub" id="m-visitors-rate">Reached the analyzer</div>
  </div>
  <div class="metric">
    <div class="metric-label">Analyses Run</div>
    <div class="metric-value orange" id="m-intake">—</div>
    <div class="metric-sub" id="m-intake-rate">Pasted JD + got results</div>
  </div>
  <div class="metric">
    <div class="metric-label">CTA Clicks</div>
    <div class="metric-value white" id="m-runs">—</div>
    <div class="metric-sub" id="m-runs-rate">Clicked "See How I Compare"</div>
  </div>
  <div class="metric">
    <div class="metric-label">Purchases</div>
    <div class="metric-value green" id="m-purchases">—</div>
    <div class="metric-sub">$99 conversions</div>
  </div>
</div>

<div class="grid2">
  <div class="card">
    <div class="card-title">Conversion Funnel</div>
    <div class="funnel" id="funnel">
      <div class="loading">Loading...</div>
    </div>
  </div>
  <div class="card">
    <div class="card-title">Traffic Sources</div>
    <div class="source-list" id="sources">
      <div class="loading">Loading...</div>
    </div>
  </div>
</div>

<div class="card" style="margin-bottom:12px;">
  <div class="card-title">Paid User Engagement</div>
  <div class="card-sub">How much are paying customers actually using SIGNAL?</div>
  <div id="engagement"><div class="loading">Loading...</div></div>
</div>

<div class="card" style="margin-bottom:12px;">
  <div class="card-title">Today's Activity</div>
  <div class="card-sub">What happened on your site in the last 24 hours, hour by hour.</div>
  <div id="activity"><div class="loading">Loading...</div></div>
</div>

<div class="card" style="margin-bottom:12px;">
  <div class="card-title">Recent Visitor Journeys</div>
  <div class="card-sub">Each row is one person — see how far they got before they left or converted.</div>
  <div id="journeys"><div class="loading">Loading...</div></div>
</div>

<script>
const SUPABASE_URL = 'https://ejhnokcnahauvrcbcmic.supabase.co'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqaG5va2NuYWhhdXZyY2JjbWljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxMzczNzMsImV4cCI6MjA4MzcxMzM3M30.LzTMZDzDrx4UMWGu9y5qeg4AzwxukEWUu06q7Ts9Wb0'

let rangeDays = 999

function setRange(days, el) {
  rangeDays = days
  document.querySelectorAll('.date-tab').forEach(t => t.classList.remove('active'))
  el.classList.add('active')
  loadAll()
}

function sinceDate() {
  if (rangeDays >= 999) return null
  const d = new Date()
  d.setDate(d.getDate() - rangeDays)
  return d.toISOString()
}

async function query(table, params) {
  // Supabase anon key caps at 1000 rows per request.
  // Paginate using offset/limit query params to get all rows.
  const pageSize = 1000
  let all = []

  for (let offset = 0; offset < 50000; offset += pageSize) {
    const url = \`\${SUPABASE_URL}/rest/v1/\${table}?\${params}&limit=\${pageSize}&offset=\${offset}\`
    const res = await fetch(url, {
      headers: {
        'apikey': ANON_KEY,
        'Authorization': \`Bearer \${ANON_KEY}\`,
        'Content-Type': 'application/json'
      }
    })
    if (!res.ok) throw new Error(\`\${res.status}: \${await res.text()}\`)
    const page = await res.json()
    all = all.concat(page)
    if (page.length < pageSize) break  // last page
  }
  return all
}

function dedupeRows(rows) {
  // Only filter bot bursts on signal_landing events — that's the only page
  // GHL pre-fetches on send (hundreds of hits in <1 second with unique session_ids)
  // All other events (intake, runs, purchases) are never bot-blasted so pass through untouched

  // Bot pattern: multiple signal_landing rows within the same 5-second window.
  // Real users don't produce 3+ landing hits in 5 seconds.
  // Count per 5-second bucket.
  const bucketCounts = {}
  rows.forEach(r => {
    if (r.page_name !== 'signal_landing') return
    const bucket = Math.floor(new Date(r.created_at).getTime() / (5 * 1000))
    bucketCounts[bucket] = (bucketCounts[bucket] || 0) + 1
  })

  // In burst buckets (>2 hits per 5 seconds), keep only the first.
  // This catches GHL pre-fetch blasts (20-200 hits/second) while preserving
  // real users who might arrive in the same minute from a shared link.
  const bucketSeen = {}
  return rows.filter(r => {
    if (r.page_name !== 'signal_landing') return true
    const bucket = Math.floor(new Date(r.created_at).getTime() / (5 * 1000))
    if (bucketCounts[bucket] > 2) {
      if (bucketSeen[bucket]) return false
      bucketSeen[bucket] = true
      return true
    }
    return true
  })
}

async function loadAll() {
  document.getElementById('last-updated').textContent = 'Refreshing...'
  try {
    const since = sinceDate()
    const timeFilter = since ? \`&created_at=gte.\${since}\` : ''

    // Fetch all page views (paginated to bypass Supabase 1000-row cap)
    const [rawRows, attrRows] = await Promise.all([
      query('jobfit_page_views', \`select=*&order=created_at.asc\${timeFilter}\`),
      query('signal_attribution', \`select=app_session_id,mkt_session_id,ref_source,ref_medium,ref_campaign,clicked_from\`).catch(() => []),
    ])
    const rows = dedupeRows(rawRows)

    // Build lookup: session_id -> attribution data
    const attrBySession = {}
    attrRows.forEach(a => {
      if (a.app_session_id) attrBySession[a.app_session_id] = a
      if (a.mkt_session_id) attrBySession[a.mkt_session_id] = a
    })

    renderMetrics(rows)
    renderFunnel(rows)
    renderSources(rows, attrBySession)
    renderEngagement(rows)
    renderActivity(rows)
    renderJourneys(rows)

    const now = new Date()
    document.getElementById('last-updated').textContent =
      \`Updated \${now.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}\`
  } catch(e) {
    document.getElementById('last-updated').textContent = 'Error: ' + e.message
  }
}

function renderMetrics(rows) {
  const landingVisitors = new Set(rows.filter(r => r.page_name === 'signal_landing').map(r => r.session_id)).size
  const analyzerVisitors = new Set(rows.filter(r => r.page_name === 'job_analysis_page').map(r => r.session_id)).size
  const analysesRun = rows.filter(r => r.page_name === 'job_analysis_run').length
  const ctaClicks = rows.filter(r => r.page_name === 'signal_cta_click').length
  const purchases = rows.filter(r => r.page_name === 'signal_purchased').length

  document.getElementById('m-landing').textContent = landingVisitors || '0'
  document.getElementById('m-visitors').textContent = analyzerVisitors || '0'
  document.getElementById('m-intake').textContent = analysesRun || '0'
  document.getElementById('m-runs').textContent = ctaClicks || '0'
  document.getElementById('m-purchases').textContent = purchases || '0'

  const landingToAnalyzer = landingVisitors > 0 ? Math.round(analyzerVisitors/landingVisitors*100) : 0
  const analyzerToRun = analyzerVisitors > 0 ? Math.round(analysesRun/analyzerVisitors*100) : 0
  const runToCta = analysesRun > 0 ? Math.round(ctaClicks/analysesRun*100) : 0

  document.getElementById('m-visitors-rate').textContent = landingVisitors > 0 ? \`\${landingToAnalyzer}% of landing visitors\` : 'Reached the analyzer'
  document.getElementById('m-intake-rate').textContent = analyzerVisitors > 0 ? \`\${analyzerToRun}% of page views\` : 'Pasted JD + got results'
  document.getElementById('m-runs-rate').textContent = analysesRun > 0 ? \`\${runToCta}% of analyses\` : 'Clicked "See How I Compare"'
}

function renderFunnel(rows) {
  const landing = new Set(rows.filter(r => r.page_name === 'signal_landing').map(r => r.session_id)).size
  const analyzerViews = new Set(rows.filter(r => r.page_name === 'job_analysis_page').map(r => r.session_id)).size
  const analysesRun = rows.filter(r => r.page_name === 'job_analysis_run').length
  const ctaClicks = rows.filter(r => r.page_name === 'signal_cta_click').length
  const purchases = rows.filter(r => r.page_name === 'signal_purchased').length

  const base = landing || analyzerViews || 1

  const steps = [
    { label: 'Landed on /signal', n: landing, color: '#51ADE5', base },
    { label: 'Reached analyzer', n: analyzerViews, color: '#7DD3FC', base },
    { label: 'Ran a job analysis', n: analysesRun, color: '#FEB06A', base },
    { label: 'Clicked upgrade CTA', n: ctaClicks, color: '#7F77DD', base },
    { label: 'Purchased ($99)', n: purchases, color: '#4AE888', base },
  ]

  const el = document.getElementById('funnel')
  if (landing === 0 && analyzerViews === 0) { el.innerHTML = '<div class="empty">No data yet</div>'; return }

  el.innerHTML = steps.map(s => {
    const pct = s.base > 0 ? Math.round(s.n / s.base * 100) : 0
    const w = s.base > 0 ? Math.max(4, Math.round(s.n / s.base * 100)) : 4
    return \`<div class="funnel-row">
      <div class="funnel-label">\${s.label}</div>
      <div class="funnel-bar-wrap">
        <div class="funnel-bar" style="width:\${w}%;background:\${s.color}">
          <span>\${s.n}</span>
        </div>
      </div>
      <div class="funnel-pct" style="color:\${s.color}">\${pct}%</div>
    </div>\`
  }).join('')
}

function renderSources(rows, attrBySession) {
  const counts = {}
  rows.forEach(r => {
    let source = 'Direct'

    // Priority 1: attribution table (joined on session_id)
    const attr = attrBySession[r.session_id]
    if (attr && attr.ref_source && attr.ref_source !== 'direct') {
      source = attr.ref_source.charAt(0).toUpperCase() + attr.ref_source.slice(1)
    }
    // Priority 2: utm_source on the page view row itself
    else if (r.utm_source) {
      source = r.utm_source.charAt(0).toUpperCase() + r.utm_source.slice(1)
    }
    // Priority 3: referrer-based fallback
    else if (r.referrer && r.referrer.includes('signal_reel')) source = 'Reel'
    else if (r.referrer && r.referrer.includes('api/reel')) source = 'Reel'
    else if (r.referrer) source = 'Referral'

    counts[source] = (counts[source] || 0) + 1
  })

  const colors = { Direct:'#51ADE5', Email:'#EF4444', Linkedin:'#0A66C2', Facebook:'#1877F2', Reel:'#FEB06A', Referral:'#7F77DD' }
  const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1])
  const max = sorted[0]?.[1] || 1

  const el = document.getElementById('sources')
  if (sorted.length === 0) { el.innerHTML = '<div class="empty">No data yet</div>'; return }

  el.innerHTML = sorted.map(([name, count]) => {
    const color = colors[name] || '#888'
    const w = Math.round(count/max*100)
    return \`<div class="source-row">
      <div class="source-dot" style="background:\${color}"></div>
      <div class="source-name">\${name}</div>
      <div class="source-bar-wrap"><div class="source-bar" style="width:\${w}%;background:\${color}"></div></div>
      <div class="source-count" style="color:\${color}">\${count}</div>
    </div>\`
  }).join('')
}

// ── Paid User Engagement ──────────────────────────────────────
function renderEngagement(rows) {
  const el = document.getElementById('engagement')
  const paidEvents = ['jobfit_full_run','positioning_run','coverletter_run','networking_run']
  const paid = rows.filter(r => paidEvents.includes(r.page_name))

  if (paid.length === 0) {
    el.innerHTML = '<div class="empty">No paid user activity yet</div>'
    return
  }

  const jobfit = paid.filter(r => r.page_name === 'jobfit_full_run').length
  const positioning = paid.filter(r => r.page_name === 'positioning_run').length
  const coverletter = paid.filter(r => r.page_name === 'coverletter_run').length
  const networking = paid.filter(r => r.page_name === 'networking_run').length
  const totalRuns = paid.length
  const activeUsers = new Set(paid.map(r => r.session_id)).size
  const avgPerUser = activeUsers > 0 ? (totalRuns / activeUsers).toFixed(1) : '0'

  // Most active day
  const dayCounts = {}
  paid.forEach(r => {
    const day = new Date(r.created_at).toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'})
    dayCounts[day] = (dayCounts[day]||0) + 1
  })
  const busiestDay = Object.entries(dayCounts).sort((a,b) => b[1]-a[1])[0]

  el.innerHTML = \`
    <div class="eng-grid">
      <div class="eng-box">
        <div class="eng-num" style="color:#7F77DD">\${activeUsers}</div>
        <div class="eng-label">Active Users</div>
        <div class="eng-sub">unique paying customers</div>
      </div>
      <div class="eng-box">
        <div class="eng-num" style="color:#fff">\${totalRuns}</div>
        <div class="eng-label">Total Runs</div>
        <div class="eng-sub">\${avgPerUser} avg per user</div>
      </div>
      <div class="eng-box">
        <div class="eng-num" style="color:#7F77DD">\${jobfit}</div>
        <div class="eng-label">JobFit</div>
        <div class="eng-sub">jobs evaluated</div>
      </div>
      <div class="eng-box">
        <div class="eng-num" style="color:#51ADE5">\${positioning}</div>
        <div class="eng-label">Positioning</div>
        <div class="eng-sub">resumes rewritten</div>
      </div>
      <div class="eng-box">
        <div class="eng-num" style="color:#FEB06A">\${coverletter}</div>
        <div class="eng-label">Cover Letters</div>
        <div class="eng-sub">letters generated</div>
      </div>
      <div class="eng-box">
        <div class="eng-num" style="color:#4AE888">\${networking}</div>
        <div class="eng-label">Networking</div>
        <div class="eng-sub">outreach plans built</div>
      </div>
      <div class="eng-box">
        <div class="eng-num" style="color:#FEB06A">\${avgPerUser}</div>
        <div class="eng-label">Tools / User</div>
        <div class="eng-sub">avg tools used per person</div>
      </div>
      <div class="eng-box">
        <div class="eng-num" style="color:#4AE888;font-size:16px">\${busiestDay ? busiestDay[0] : '—'}</div>
        <div class="eng-label">Busiest Day</div>
        <div class="eng-sub">\${busiestDay ? busiestDay[1]+' runs' : ''}</div>
      </div>
    </div>
  \`
}

// ── Today's Activity (24h, grouped by hour) ──────────────────
function renderActivity(rows) {
  const el = document.getElementById('activity')
  const now = new Date()
  const yesterday = new Date(now.getTime() - 24*60*60*1000)
  const recent = rows.filter(r => new Date(r.created_at) >= yesterday)

  if (recent.length === 0) {
    el.innerHTML = '<div class="empty">No activity in the last 24 hours</div>'
    return
  }

  const pillConfig = {
    'signal_landing':         { label: 'Landing Visit',     bg: 'rgba(81,173,229,0.15)',  color: '#51ADE5' },
    'job_analysis_page':      { label: 'Analyzer View',     bg: 'rgba(125,211,252,0.18)', color: '#7DD3FC' },
    'job_analysis_run':       { label: 'Analysis Run',      bg: 'rgba(254,176,106,0.15)', color: '#FEB06A' },
    'signal_cta_click':       { label: 'Upgrade CTA',       bg: 'rgba(127,119,221,0.15)', color: '#7F77DD' },
    'signal_purchased':       { label: '$99 Purchase',      bg: 'rgba(74,232,136,0.20)',  color: '#4AE888' },
    // Legacy events (kept for backward compat with old data)
    'jobfit_trial_intake':    { label: 'Intake (legacy)',   bg: 'rgba(255,255,255,0.06)', color: '#888' },
    'jobfit_trial_completed': { label: 'Signup (legacy)',   bg: 'rgba(255,255,255,0.06)', color: '#888' },
    'jobfit_run_completed':   { label: 'Trial Run (legacy)',bg: 'rgba(255,255,255,0.06)', color: '#888' },
    'jobfit_full_run':        { label: 'JobFit',            bg: 'rgba(127,119,221,0.15)', color: '#7F77DD' },
    'positioning_run':        { label: 'Position',          bg: 'rgba(81,173,229,0.15)',  color: '#51ADE5' },
    'coverletter_run':        { label: 'Letter',            bg: 'rgba(254,176,106,0.15)', color: '#FEB06A' },
    'networking_run':         { label: 'Network',           bg: 'rgba(74,232,136,0.15)',  color: '#4AE888' },
  }

  // Group by hour
  const hours = {}
  recent.forEach(r => {
    const d = new Date(r.created_at)
    const hourKey = d.toLocaleTimeString([], {hour:'numeric', hour12:true})
    if (!hours[hourKey]) hours[hourKey] = {}
    const name = r.page_name
    hours[hourKey][name] = (hours[hourKey][name]||0) + 1
  })

  // Sort hours newest first
  const hourEntries = Object.entries(hours)

  el.innerHTML = hourEntries.reverse().map(([hour, events]) => {
    const pills = Object.entries(events).map(([name, count]) => {
      const cfg = pillConfig[name] || { label: name, bg: 'rgba(255,255,255,0.08)', color: '#888' }
      return \`<span class="hour-pill" style="background:\${cfg.bg};color:\${cfg.color}">\${count} \${cfg.label}</span>\`
    }).join('')
    return \`<div class="hour-row">
      <div class="hour-label">\${hour}</div>
      <div class="hour-pills">\${pills}</div>
    </div>\`
  }).join('')
}

// ── Visitor Journeys ─────────────────────────────────────────
function renderJourneys(rows) {
  const el = document.getElementById('journeys')

  // Group all events by session_id
  const sessions = {}
  rows.forEach(r => {
    if (!sessions[r.session_id]) sessions[r.session_id] = []
    sessions[r.session_id].push(r)
  })

  // Define the funnel step order
  const stepOrder = {
    'signal_landing': 0,
    'job_analysis_page': 1,
    'job_analysis_run': 2,
    'signal_cta_click': 3,
    'signal_purchased': 4,
    // Legacy events at the end
    'jobfit_trial_intake': 10,
    'jobfit_trial_completed': 11,
    'jobfit_run_completed': 12,
    'jobfit_full_run': 13,
    'positioning_run': 14,
    'coverletter_run': 15,
    'networking_run': 16,
  }

  const stepConfig = {
    'signal_landing':         { label: 'Landed',         bg: 'rgba(81,173,229,0.12)',  color: '#51ADE5' },
    'job_analysis_page':      { label: 'Reached Analyzer', bg: 'rgba(125,211,252,0.15)', color: '#7DD3FC' },
    'job_analysis_run':       { label: 'Ran Analysis',   bg: 'rgba(254,176,106,0.15)', color: '#FEB06A' },
    'signal_cta_click':       { label: 'Clicked CTA',    bg: 'rgba(127,119,221,0.15)', color: '#7F77DD' },
    'signal_purchased':       { label: 'Purchased',      bg: 'rgba(74,232,136,0.20)',  color: '#4AE888' },
    // Legacy events (kept for old data)
    'jobfit_trial_intake':    { label: 'Started Intake (legacy)', bg: 'rgba(255,255,255,0.06)', color: '#888' },
    'jobfit_trial_completed': { label: 'Signed Up (legacy)',  bg: 'rgba(255,255,255,0.06)', color: '#888' },
    'jobfit_run_completed':   { label: 'Ran JobFit (legacy)', bg: 'rgba(255,255,255,0.06)', color: '#888' },
    'jobfit_full_run':        { label: 'JobFit',         bg: 'rgba(127,119,221,0.15)', color: '#7F77DD' },
    'positioning_run':        { label: 'Positioning',    bg: 'rgba(81,173,229,0.12)',  color: '#51ADE5' },
    'coverletter_run':        { label: 'Letter',         bg: 'rgba(254,176,106,0.12)', color: '#FEB06A' },
    'networking_run':         { label: 'Networking', bg: 'rgba(74,232,136,0.12)',  color: '#4AE888' },
  }

  // Build journey per session — deduplicate steps, keep order
  const journeys = Object.entries(sessions).map(([sid, events]) => {
    const seen = new Set()
    const steps = events
      .sort((a,b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .filter(e => {
        if (seen.has(e.page_name)) return false
        seen.add(e.page_name)
        return true
      })
    const lastTime = new Date(events[events.length-1].created_at)
    const maxStep = Math.max(...steps.map(s => stepOrder[s.page_name] ?? -1))
    return { sid, steps, lastTime, maxStep }
  })

  // Sort: most recent activity first, but prioritize longer journeys
  journeys.sort((a,b) => b.lastTime.getTime() - a.lastTime.getTime())

  // Show top 15
  const top = journeys.slice(0, 15)

  if (top.length === 0) {
    el.innerHTML = '<div class="empty">No visitor data yet</div>'
    return
  }

  el.innerHTML = top.map(j => {
    const stepsHtml = j.steps.map((s, i) => {
      const cfg = stepConfig[s.page_name] || { label: s.page_name, bg: 'rgba(255,255,255,0.08)', color: '#888' }
      const arrow = i < j.steps.length - 1 ? '<span class="journey-arrow">→</span>' : ''
      return \`<span class="journey-step" style="background:\${cfg.bg};color:\${cfg.color}">\${cfg.label}</span>\${arrow}\`
    }).join('')

    const ago = timeAgo(j.lastTime)

    return \`<div class="journey-row">\${stepsHtml}<span class="journey-time">\${ago}</span></div>\`
  }).join('')
}

function timeAgo(date) {
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return mins + 'm ago'
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return hrs + 'h ago'
  const days = Math.floor(hrs / 24)
  return days + 'd ago'
}

loadAll()
setInterval(loadAll, 60000)
</script>
</body>
</html>
`
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}