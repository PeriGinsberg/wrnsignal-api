module.exports = [
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/@opentelemetry/api [external] (next/dist/compiled/@opentelemetry/api, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/@opentelemetry/api", () => require("next/dist/compiled/@opentelemetry/api"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[project]/app/api/_lib/cors.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "corsOptionsResponse",
    ()=>corsOptionsResponse,
    "withCorsJson",
    ()=>withCorsJson
]);
const DEFAULT_ALLOW_METHODS = [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS"
];
const DEFAULT_ALLOW_HEADERS = [
    "authorization",
    "content-type",
    "x-jobfit-key",
    "accept"
];
const DEFAULT_MAX_AGE = 86400;
function isAllowedOrigin(origin, allowOrigins) {
    if (!origin) return false;
    const o = origin.trim().toLowerCase();
    // Explicit allow list support (optional)
    if (allowOrigins?.length) {
        const normalized = allowOrigins.map((x)=>x.trim().toLowerCase());
        if (normalized.includes(o)) return true;
    }
    // Production domains
    if (o === "https://wrnsignal.workforcereadynow.com") return true;
    if (o === "https://www.workforcereadynow.com") return true;
    if (o === "https://workforcereadynow.com") return true;
    // Framer hosted sites
    if (o.endsWith(".framer.app")) return true;
    // Framer Canvas preview (this is your current failing origin)
    // Example: https://project-xxxxxxxxxxxxxxxx.framercanvas.com
    if (o.endsWith(".framercanvas.com")) return true;
    // Local dev
    if (o.startsWith("http://localhost")) return true;
    if (o.startsWith("http://127.0.0.1")) return true;
    return false;
}
function buildCorsHeaders(origin, cfg) {
    const allowMethods = (cfg?.allowMethods?.length ? cfg.allowMethods : DEFAULT_ALLOW_METHODS).join(", ");
    const allowHeaders = (cfg?.allowHeaders?.length ? cfg.allowHeaders : DEFAULT_ALLOW_HEADERS).join(", ");
    const maxAge = String(cfg?.maxAgeSeconds ?? DEFAULT_MAX_AGE);
    const headers = new Headers();
    // Bearer token auth (no cookies), so do NOT set Allow-Credentials.
    if (origin && isAllowedOrigin(origin, cfg?.allowOrigins)) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Vary", "Origin");
    }
    headers.set("Access-Control-Allow-Methods", allowMethods);
    headers.set("Access-Control-Allow-Headers", allowHeaders);
    headers.set("Access-Control-Max-Age", maxAge);
    headers.set("Access-Control-Expose-Headers", "content-type");
    return headers;
}
function corsOptionsResponse(origin, cfg) {
    const headers = buildCorsHeaders(origin, cfg);
    return new Response(null, {
        status: 204,
        headers
    });
}
function withCorsJson(req, data, status = 200, cfg) {
    const origin = req.headers.get("origin");
    const headers = buildCorsHeaders(origin, cfg);
    headers.set("Content-Type", "application/json; charset=utf-8");
    return new Response(JSON.stringify(data), {
        status,
        headers
    });
}
}),
"[project]/app/api/jobfit/evaluator.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/* FILE: app/api/jobfit/evaluator.ts */ __turbopack_context__.s([
    "evaluateJobFit",
    ()=>evaluateJobFit
]);
(()=>{
    const e = new Error("Cannot find module './extract'");
    e.code = 'MODULE_NOT_FOUND';
    throw e;
})();
(()=>{
    const e = new Error("Cannot find module './constraints'");
    e.code = 'MODULE_NOT_FOUND';
    throw e;
})();
(()=>{
    const e = new Error("Cannot find module './scoring'");
    e.code = 'MODULE_NOT_FOUND';
    throw e;
})();
(()=>{
    const e = new Error("Cannot find module './decision'");
    e.code = 'MODULE_NOT_FOUND';
    throw e;
})();
;
;
;
;
function nextStepForDecision(d) {
    if (d === "Apply") return "Apply. Then send 2 targeted networking messages within 24 hours.";
    if (d === "Review") return "Only proceed if you can reduce the top risks. If yes, apply and network immediately.";
    return "Pass. Do not apply. Put that effort into a better-fit role.";
}
function clampScoreToDecision(d, s) {
    if (d === "Pass") return Math.min(s, 39);
    if (d === "Review") return Math.max(40, Math.min(s, 69));
    return Math.max(70, Math.min(s, 97));
}
function evaluateJobFit(input) {
    const job = extractJobSignals(input.jobText);
    const profile = extractProfileSignals(input.profileText || "", input.profileOverrides);
    const gate = evaluateGates(job, profile);
    const scoring = scoreJobFit(job, profile);
    let decision = decisionFromScore(scoring.score);
    decision = applyGateOverrides(decision, gate);
    decision = applyRiskDowngrades(decision, scoring.penaltySum);
    const location_constraint = job.location.constrained || profile.locationPreference.constrained ? "constrained" : job.location.mode === "unclear" && profile.locationPreference.mode === "unclear" ? "unclear" : "not_constrained";
    const clampedScore = clampScoreToDecision(decision, scoring.score);
    return {
        decision,
        score: clampedScore,
        bullets: [],
        risk_flags: [],
        next_step: nextStepForDecision(decision),
        location_constraint,
        why_codes: scoring.whyCodes,
        risk_codes: scoring.riskCodes,
        gate_triggered: gate,
        job_signals: job,
        profile_signals: profile
    };
}
}),
"[project]/app/api/jobfit-regress/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "OPTIONS",
    ()=>OPTIONS,
    "POST",
    ()=>POST,
    "runtime",
    ()=>runtime
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$app$2f$api$2f$_lib$2f$cors$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/app/api/_lib/cors.ts [app-route] (ecmascript)");
// ✅ IMPORTANT:
// You may need to adjust this import to match your actual evaluator export.
// Run: Select-String -Path .\app\api\jobfit\evaluator.ts -Pattern "export" -Context 0,2
var __TURBOPACK__imported__module__$5b$project$5d2f$app$2f$api$2f$jobfit$2f$evaluator$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/app/api/jobfit/evaluator.ts [app-route] (ecmascript)");
;
;
;
const runtime = "nodejs";
function isBypassAllowed(req) {
    const nodeEnv = ("TURBOPACK compile-time value", "development") ?? "development";
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    const expected = process.env.JOBFIT_TEST_KEY ?? "";
    const provided = req.headers.get("x-jobfit-test-key") ?? "";
    return expected.length > 0 && provided === expected;
}
async function OPTIONS() {
    return new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"](null, {
        status: 204,
        headers: __TURBOPACK__imported__module__$5b$project$5d2f$app$2f$api$2f$_lib$2f$cors$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["corsHeaders"]
    });
}
async function POST(req) {
    try {
        if (!isBypassAllowed(req)) {
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                error: "Unauthorized: missing/invalid x-jobfit-test-key"
            }, {
                status: 401,
                headers: __TURBOPACK__imported__module__$5b$project$5d2f$app$2f$api$2f$_lib$2f$cors$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["corsHeaders"]
            });
        }
        const body = await req.json().catch(()=>null);
        if (!body || typeof body.job !== "string" || typeof body.profileText !== "string") {
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                error: "Invalid body. Expected: { job: string, profileText: string, profileStructured?: object }"
            }, {
                status: 400,
                headers: __TURBOPACK__imported__module__$5b$project$5d2f$app$2f$api$2f$_lib$2f$cors$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["corsHeaders"]
            });
        }
        const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$app$2f$api$2f$jobfit$2f$evaluator$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["evaluateJobFit"])({
            job: body.job,
            profileText: body.profileText,
            profileStructured: body.profileStructured ?? null,
            mode: "regress"
        });
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json(result, {
            status: 200,
            headers: __TURBOPACK__imported__module__$5b$project$5d2f$app$2f$api$2f$_lib$2f$cors$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["corsHeaders"]
        });
    } catch (err) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: "JobFit regress route failed",
            detail: String(err?.message ?? err)
        }, {
            status: 500,
            headers: __TURBOPACK__imported__module__$5b$project$5d2f$app$2f$api$2f$_lib$2f$cors$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["corsHeaders"]
        });
    }
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__f11dbb93._.js.map