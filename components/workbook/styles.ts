// components/workbook/styles.ts
//
// The WRN editorial workbook style (spec "Design", design-reference/*.dc.html).
// Neither the dark coach theme nor the light theme: its own tokens, scoped under
// .wb-root so nothing leaks into the rest of the dashboard.
//
// Rules the spec fixes and this file holds: square corners, no gradients, no
// left-border cards, no chat bubbles, underline-only fill-ins, orange only for
// section numbers, rules, eyebrow labels and bullets (never body text), touch
// targets of at least 44px.

export const WB = {
  navy: "#08203F",
  blue: "#009BFF",
  pale: "#B6F2F8",
  teal: "#00B3B3",
  tealInk: "#007A7A",
  orange: "#FF6B00",
  peach: "#FFEEDC",
  bg: "#FCFBF8",
  border: "#DCE1E8",
  muted: "#4A5A70",
  line: "#B7C1CF",
} as const

export const WORKBOOK_CSS = `
.wb-root{--navy:${WB.navy};--blue:${WB.blue};--pale:${WB.pale};--teal:${WB.teal};--teal-ink:${WB.tealInk};--orange:${WB.orange};--peach:${WB.peach};--bg:${WB.bg};--border:${WB.border};--muted:${WB.muted};--line:${WB.line};
  background:var(--bg);color:var(--navy);font-family:var(--wb-font-sans),system-ui,sans-serif;font-size:17px;line-height:1.55}
.wb-root *{box-sizing:border-box;border-radius:0}
.wb-root a{color:var(--navy)}
.wb-root a:hover{color:var(--blue)}
.wb-root :focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.wb-serif{font-family:var(--wb-font-serif),Georgia,serif}
.wb-eyebrow{font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--orange)}
.wb-eyebrow-ink{font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--navy)}
.wb-muted{color:var(--muted)}
.wb-page{min-height:100vh;display:flex;flex-direction:column}

.wb-header{min-height:72px;padding:12px 48px;display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid var(--border);background:#fff;position:sticky;top:0;z-index:5}
.wb-brand{display:flex;align-items:center;gap:12px;font-size:14px;font-weight:700;letter-spacing:.16em}
.wb-brand i{width:10px;height:10px;background:var(--orange);display:inline-block}
.wb-header-actions{display:flex;align-items:center;gap:16px;flex-wrap:wrap;justify-content:flex-end}
.wb-saved{display:inline-flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:var(--teal-ink)}
.wb-saving{font-size:14px;font-weight:600;color:var(--muted)}
.wb-warn{font-size:14px;font-weight:600;color:var(--navy);background:var(--peach);padding:6px 10px}

.wb-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;font:inherit;font-size:15px;font-weight:600;cursor:pointer;text-decoration:none;border:1.5px solid var(--navy);background:transparent;color:var(--navy)}
.wb-btn:hover{border-color:var(--blue);color:var(--navy)}
.wb-btn-solid{background:var(--navy);color:#fff;border-color:var(--navy)}
.wb-btn-solid:hover{background:#0d2f5c;color:#fff}
.wb-btn-teal{background:var(--teal);color:var(--navy);border-color:var(--teal);font-weight:700}
.wb-btn:disabled{opacity:.5;cursor:default}
.wb-link{background:none;border:0;padding:0;min-height:44px;font:inherit;font-size:15px;font-weight:600;color:var(--navy);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.wb-link:hover{color:var(--blue)}

.wb-shell{display:flex;flex:1;align-items:stretch}
.wb-nav{width:300px;flex-shrink:0;padding:48px 32px;border-right:1px solid var(--border);background:#fff;display:flex;flex-direction:column;gap:32px}
.wb-nav-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.wb-nav-item{display:flex;gap:14px;align-items:baseline;width:100%;min-height:44px;padding:10px 12px;font:inherit;font-size:15px;line-height:1.35;text-align:left;border:0;background:transparent;color:#2E4260;cursor:pointer}
.wb-nav-item[aria-current="true"]{background:var(--peach);font-weight:700;color:var(--navy)}
.wb-nav-num{font-family:var(--wb-font-serif),Georgia,serif;font-weight:700;width:24px;flex-shrink:0;color:var(--orange)}
.wb-nav-num.done{color:var(--teal)}

.wb-main{flex:1;min-width:0;padding:64px 72px 140px;display:flex;flex-direction:column;gap:44px}
.wb-row{display:grid;grid-template-columns:minmax(0,1fr) 272px;column-gap:56px;align-items:start}
.wb-col{display:flex;flex-direction:column;gap:20px;min-width:0}
.wb-aside{display:flex;flex-direction:column;gap:16px}

.wb-secnum{font-family:var(--wb-font-serif),Georgia,serif;font-size:96px;font-weight:700;line-height:.9;color:var(--orange)}
.wb-h1{margin:0;font-family:var(--wb-font-serif),Georgia,serif;font-size:60px;font-weight:600;line-height:1.04;letter-spacing:-.01em}
.wb-h2{margin:0;font-family:var(--wb-font-serif),Georgia,serif;font-size:34px;font-weight:600;line-height:1.12}
.wb-rule{height:2px;width:64px;background:var(--orange)}
.wb-p{margin:0;font-size:18px;line-height:1.6}
.wb-lead{margin:0;font-size:22px;line-height:1.55}
.wb-label{font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--orange)}

.wb-callout{padding:28px 32px;display:flex;flex-direction:column;gap:12px}
.wb-callout.paleblue{background:var(--pale)}
.wb-callout.peach{background:var(--peach)}
.wb-callout-title{font-weight:700;font-size:15px;letter-spacing:.06em;text-transform:uppercase}
.wb-bigquote{background:var(--peach);padding:44px 52px;margin:0;font-family:var(--wb-font-serif),Georgia,serif;font-size:42px;line-height:1.2;font-weight:600}
.wb-wordtrack{background:var(--peach);padding:24px 28px;display:flex;flex-direction:column;gap:10px}
.wb-wordtrack p{margin:0;font-family:var(--wb-font-serif),Georgia,serif;font-size:20px;line-height:1.45}

.wb-ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
.wb-ul li{display:flex;gap:14px;align-items:baseline;font-size:18px;line-height:1.5}
.wb-ul li::before{content:"";width:8px;height:8px;background:var(--orange);flex-shrink:0;transform:translateY(-2px)}
.wb-ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px}
.wb-ol li{display:grid;grid-template-columns:36px minmax(0,1fr);font-size:18px;line-height:1.5}
.wb-ol li b{font-family:var(--wb-font-serif),Georgia,serif;font-weight:700;color:var(--orange);font-size:22px;line-height:1.2}
.wb-quotes div{padding:16px 0;border-bottom:1px solid var(--border);font-family:var(--wb-font-serif),Georgia,serif;font-size:22px}

.wb-note{background:var(--peach);padding:22px 24px;display:flex;flex-direction:column;gap:8px}
.wb-note-body{font-family:var(--wb-font-serif),Georgia,serif;font-size:20px;line-height:1.35}
.wb-coachonly{border:1.5px dashed var(--navy);background:#fff;padding:18px 20px;display:flex;flex-direction:column;gap:6px}

.wb-field{display:flex;flex-direction:column;gap:8px}
.wb-field-head{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:14px;align-items:baseline}
.wb-field-num{font-family:var(--wb-font-serif),Georgia,serif;font-size:28px;font-weight:700;color:var(--orange);line-height:1.1}
.wb-field-label{font-size:19px;font-weight:600;line-height:1.45}
.wb-input{width:100%;border:0;border-bottom:1.5px solid var(--line);background:transparent;padding:8px 0;font:inherit;font-size:18px;line-height:1.6;color:var(--navy);min-height:44px}
.wb-input:focus{outline:none;border-bottom-color:var(--blue)}
textarea.wb-input{resize:vertical;overflow:hidden}
.wb-field-foot{display:flex;flex-wrap:wrap;align-items:center;gap:16px;min-height:28px;font-size:13px}
.wb-conflict{background:var(--peach);padding:14px 16px;display:flex;flex-direction:column;gap:10px;font-size:15px}

.wb-hook{background:var(--peach);padding:40px 48px;display:flex;flex-direction:column;gap:18px}
.wb-hook-line{margin:0;font-family:var(--wb-font-serif),Georgia,serif;font-size:34px;font-weight:600;line-height:1.2}
.wb-hook .wb-input{border-bottom:2px solid var(--navy);font-size:22px}

.wb-pick{display:flex;flex-direction:column;gap:6px;border:0;margin:0;padding:0}
.wb-pick label{display:flex;gap:14px;align-items:center;min-height:48px;padding:8px 12px;border:1px solid var(--border);background:#fff;font-size:17px;cursor:pointer}
.wb-pick label.on{border:2px solid var(--blue)}
.wb-pick input[type=radio]{width:20px;height:20px;accent-color:var(--blue);flex-shrink:0;margin:0}

.wb-block{border-top:1px solid var(--border);padding-top:28px;display:flex;flex-direction:column;gap:18px}
.wb-block-title{display:flex;gap:16px;align-items:baseline}
.wb-block-title b{font-family:var(--wb-font-serif),Georgia,serif;font-size:34px;font-weight:700;color:var(--orange);line-height:1}
.wb-block-title span{font-family:var(--wb-font-serif),Georgia,serif;font-size:26px;font-weight:600;line-height:1.2}

.wb-card{border:1.5px solid var(--navy);background:#fff;padding:20px;display:flex;flex-direction:column;gap:12px}
.wb-card-soft{border:1px solid var(--border);background:#fff;padding:18px;display:flex;flex-direction:column;gap:10px}
.wb-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.wb-tag{display:inline-flex;align-items:center;min-height:26px;padding:0 10px;font-size:12px;font-weight:700;white-space:nowrap}
.wb-tag.new{color:var(--teal-ink);padding:0}
.wb-tag.draft{background:#EEF1F5;color:#2E4260}
.wb-tag.review{background:var(--peach)}
.wb-tag.ok{background:#D6F5F5;color:#005F5F}
.wb-tag.sent{background:var(--pale)}
.wb-strike{text-decoration:line-through;color:var(--muted)}
.wb-mark{background:var(--peach);padding:2px 4px}
.wb-textarea-box{width:100%;border:1.5px solid var(--line);background:var(--bg);padding:12px;font:inherit;font-size:16px;line-height:1.5;color:var(--navy);resize:vertical}
.wb-textarea-box:focus{outline:none;border-color:var(--blue)}
.wb-actions{display:flex;gap:10px;flex-wrap:wrap}

.wb-pager{display:flex;justify-content:space-between;align-items:center;gap:16px;border-top:1px solid var(--border);padding-top:28px;flex-wrap:wrap}
.wb-bottombar{display:none}
.wb-progress{height:4px;background:#E6EAF0}
.wb-progress i{display:block;height:4px;background:var(--blue)}

.wb-panel-back{position:fixed;inset:0;background:rgba(8,32,63,.35);z-index:20;display:flex;justify-content:flex-end}
.wb-panel{width:min(480px,100%);height:100%;overflow:auto;background:#fff;padding:32px;display:flex;flex-direction:column;gap:20px}

.wb-review{display:grid;grid-template-columns:260px minmax(0,1fr) 360px;gap:36px;padding:28px 28px 64px;align-items:start}
.wb-review-nav{background:#fff;border:1px solid var(--border)}
@media (max-width:1280px){ .wb-review{grid-template-columns:220px minmax(0,1fr)} .wb-review>aside{grid-column:1/-1} }
@media (max-width:820px){ .wb-review{grid-template-columns:minmax(0,1fr);padding:16px} }

@media (max-width:1180px){
  .wb-row{grid-template-columns:minmax(0,1fr)}
  .wb-aside{margin-top:16px}
  .wb-main{padding:56px 48px 140px}
}
@media (max-width:820px){
  .wb-root{font-size:16px}
  .wb-header{padding:12px 20px}
  .wb-brand{font-size:12px}
  .wb-nav{display:none}
  .wb-main{padding:32px 20px 140px;gap:36px}
  .wb-secnum{font-size:64px}
  .wb-h1{font-size:38px;line-height:1.08}
  .wb-h2{font-size:26px}
  .wb-lead{font-size:18px}
  .wb-bigquote{font-size:28px;padding:28px 24px}
  .wb-hook{padding:28px 22px}
  .wb-hook-line{font-size:25px}
  .wb-callout{padding:20px}
  .wb-bottombar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:6;padding:12px 20px;background:#fff;border-top:1px solid var(--border);align-items:center;gap:12px}
  .wb-pager{display:none}
  .wb-hide-phone{display:none}
}
@media (min-width:821px){ .wb-show-phone{display:none} }
`
