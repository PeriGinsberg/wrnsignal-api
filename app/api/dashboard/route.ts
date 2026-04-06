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

.loading{color:rgba(255,255,255,0.30);font-size:13px;text-align:center;padding:20px;}
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
    <div class="metric-label">JobFit Intake Visitors</div>
    <div class="metric-value blue" id="m-visitors">—</div>
    <div class="metric-sub" id="m-visitors-rate">Unique sessions on intake</div>
  </div>
  <div class="metric">
    <div class="metric-label">Intake Completed</div>
    <div class="metric-value orange" id="m-intake">—</div>
    <div class="metric-sub" id="m-intake-rate">Trial signups</div>
  </div>
  <div class="metric">
    <div class="metric-label">JobFit Runs</div>
    <div class="metric-value white" id="m-runs">—</div>
    <div class="metric-sub" id="m-runs-rate">Activations</div>
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
  <div class="card-title">Recent Events</div>
  <div class="events-list" id="events">
    <div class="loading">Loading...</div>
  </div>
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
  let url = \`\${SUPABASE_URL}/rest/v1/\${table}?\${params}\`
  const res = await fetch(url, {
    headers: {
      'apikey': ANON_KEY,
      'Authorization': \`Bearer \${ANON_KEY}\`,
      'Content-Type': 'application/json'
    }
  })
  if (!res.ok) throw new Error(\`\${res.status}: \${await res.text()}\`)
  return res.json()
}

function dedupeRows(rows) {
  // Only filter bot bursts on signal_landing events — that's the only page
  // GHL pre-fetches on send (hundreds of hits in <2 minutes)
  // All other events (intake, runs, purchases) are never bot-blasted so pass through untouched

  // Count signal_landing events per 60-second bucket
  const bucketCounts = {}
  rows.forEach(r => {
    if (r.page_name !== 'signal_landing') return
    const bucket = Math.floor(new Date(r.created_at).getTime() / (60 * 1000))
    bucketCounts[bucket] = (bucketCounts[bucket] || 0) + 1
  })

  // In burst buckets (>5 signal_landing hits/min), keep only the first
  const bucketSeen = {}
  return rows.filter(r => {
    if (r.page_name !== 'signal_landing') return true  // always keep non-landing events
    const bucket = Math.floor(new Date(r.created_at).getTime() / (60 * 1000))
    if (bucketCounts[bucket] > 5) {
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

    // Fetch page views in two queries to avoid bot-burst rows blowing the limit:
    // 1. Non-landing events (intake, runs, purchases) — these are never bots, fetch all
    // 2. Landing events — fetch newest first with a reasonable cap, then dedupe
    const [nonLandingRows, landingRows, attrRows] = await Promise.all([
      query('jobfit_page_views', \`select=*&page_name=neq.signal_landing&order=created_at.asc&limit=50000\${timeFilter}\`),
      query('jobfit_page_views', \`select=*&page_name=eq.signal_landing&order=created_at.desc&limit=20000\${timeFilter}\`),
      query('signal_attribution', \`select=app_session_id,mkt_session_id,ref_source,ref_medium,ref_campaign,clicked_from&limit=10000\`).catch(() => []),
    ])
    // Reverse landing rows back to ascending for consistent processing
    landingRows.reverse()
    const rawRows = [...landingRows, ...nonLandingRows].sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
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
    renderEvents(rows)

    const now = new Date()
    document.getElementById('last-updated').textContent =
      \`Updated \${now.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}\`
  } catch(e) {
    document.getElementById('last-updated').textContent = 'Error: ' + e.message
  }
}

function renderMetrics(rows) {
  const landingVisitors = new Set(rows.filter(r => r.page_name === 'signal_landing').map(r => r.session_id)).size
  const intakeVisitors  = new Set(rows.filter(r => r.page_name === 'jobfit_trial_intake').map(r => r.session_id)).size
  const intakeCompleted = rows.filter(r => r.page_name === 'jobfit_trial_completed').length
  const runs = rows.filter(r => r.page_name === 'jobfit_run_completed').length
  const purchases = rows.filter(r => r.page_name === 'signal_purchased').length

  document.getElementById('m-landing').textContent = landingVisitors || '0'
  document.getElementById('m-visitors').textContent = intakeVisitors || '0'
  document.getElementById('m-intake').textContent = intakeCompleted || '0'
  document.getElementById('m-runs').textContent = runs || '0'
  document.getElementById('m-purchases').textContent = purchases || '0'

  const intakeRate = intakeVisitors > 0 ? Math.round(intakeCompleted/intakeVisitors*100) : 0
  const runRate = intakeCompleted > 0 ? Math.round(runs/intakeCompleted*100) : 0
  const landingToIntake = landingVisitors > 0 ? Math.round(intakeVisitors/landingVisitors*100) : 0

  document.getElementById('m-visitors-rate').textContent = landingVisitors > 0 ? \`\${landingToIntake}% of landing visitors\` : 'Unique sessions on intake'
  document.getElementById('m-intake-rate').textContent = intakeVisitors > 0 ? \`\${intakeRate}% of intake visitors\` : 'Trial signups'
  document.getElementById('m-runs-rate').textContent = intakeCompleted > 0 ? \`\${runRate}% of signups\` : 'Activations'
}

function renderFunnel(rows) {
  const visitors = new Set(rows.filter(r => r.page_name === 'jobfit_trial_intake').map(r => r.session_id)).size
  const intakeDone = rows.filter(r => r.page_name === 'jobfit_trial_completed').length
  const runs = rows.filter(r => r.page_name === 'jobfit_run_completed').length
  const purchases = rows.filter(r => r.page_name === 'signal_purchased').length

  const steps = [
    { label: 'Visited app', n: visitors, color: '#51ADE5', base: visitors },
    { label: 'Completed intake', n: intakeDone, color: '#FEB06A', base: visitors },
    { label: 'Ran a JobFit', n: runs, color: '#7F77DD', base: visitors },
    { label: 'Purchased ($99)', n: purchases, color: '#4AE888', base: visitors },
  ]

  const el = document.getElementById('funnel')
  if (visitors === 0) { el.innerHTML = '<div class="empty">No data yet</div>'; return }

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

function renderEvents(rows) {
  const recent = rows.slice(-12).reverse()
  const el = document.getElementById('events')

  if (recent.length === 0) { el.innerHTML = '<div class="empty">No events yet</div>'; return }

  const eventConfig = {
    'jobfit_trial_intake':    { label: 'Visited trial intake',     color: '#51ADE5', badge: 'badge-blue',   badgeText: 'Intake' },
    'jobfit_trial_completed': { label: 'Completed trial signup',   color: '#FEB06A', badge: 'badge-orange', badgeText: 'Signup' },
    'jobfit_run_completed':   { label: 'Ran a JobFit (trial)',     color: '#7F77DD', badge: 'badge-purple', badgeText: 'Trial Run' },
    'jobfit_full_run':        { label: 'Ran JobFit (full access)', color: '#7F77DD', badge: 'badge-purple', badgeText: 'JobFit' },
    'positioning_run':        { label: 'Ran Positioning',          color: '#51ADE5', badge: 'badge-blue',   badgeText: 'Position' },
    'coverletter_run':        { label: 'Ran Cover Letter',         color: '#FEB06A', badge: 'badge-orange', badgeText: 'Letter' },
    'networking_run':         { label: 'Ran Networking',            color: '#4AE888', badge: 'badge-green',  badgeText: 'Network' },
    'signal_purchased':       { label: 'Purchased full access',    color: '#4AE888', badge: 'badge-green',  badgeText: 'Purchase' },
  }

  el.innerHTML = recent.map(r => {
    const cfg = eventConfig[r.page_name] || { label: r.page_name, color: '#888', badge: 'badge-blue', badgeText: 'Event' }
    const d = new Date(r.created_at)
    const time = d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})
    const source = r.utm_source ? \` · \${r.utm_source}\` : (r.referrer?.includes('reel') ? ' · reel' : '')
    return \`<div class="event-row">
      <div class="event-time">\${time}</div>
      <div class="event-dot" style="background:\${cfg.color}"></div>
      <div class="event-name">\${cfg.label}\${source}</div>
      <div class="event-badge \${cfg.badge}">\${cfg.badgeText}</div>
    </div>\`
  }).join('')
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