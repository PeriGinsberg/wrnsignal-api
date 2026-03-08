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
"[project]/app/api/version/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GET",
    ()=>GET,
    "OPTIONS",
    ()=>OPTIONS,
    "dynamic",
    ()=>dynamic,
    "runtime",
    ()=>runtime
]);
// FILE: app/api/version/route.ts
var __TURBOPACK__imported__module__$5b$project$5d2f$app$2f$api$2f$_lib$2f$cors$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/app/api/_lib/cors.ts [app-route] (ecmascript)");
;
const runtime = "nodejs";
const dynamic = "force-dynamic";
function pick(name) {
    return (process.env[name] ?? "").trim() || null;
}
async function OPTIONS(req) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$app$2f$api$2f$_lib$2f$cors$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["corsOptionsResponse"])(req.headers.get("origin"));
}
async function GET(req) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$app$2f$api$2f$_lib$2f$cors$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["withCorsJson"])(req, {
        env: pick("VERCEL_ENV") ?? pick("NODE_ENV") ?? "unknown",
        git_sha: pick("VERCEL_GIT_COMMIT_SHA") ?? pick("GIT_SHA"),
        jobfit_logic_version: pick("JOBFIT_LOGIC_VERSION"),
        route_jobfit_stamp: pick("ROUTE_JOBFIT_STAMP"),
        profile_v4_stamp: pick("PROFILE_V4_STAMP"),
        renderer_v4_stamp: pick("RENDERER_V4_STAMP"),
        taxonomy_v4_stamp: pick("TAXONOMY_V4_STAMP"),
        types_v4_stamp: pick("TYPES_V4_STAMP"),
        built_at_utc: new Date().toISOString()
    });
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__c6615020._.js.map