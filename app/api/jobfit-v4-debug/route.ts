/* app/api/jobfit-v4-debug/route.ts
   CLEAN REWRITE: deterministic, explicit stamps, dev-friendly error payloads
*/

import { NextResponse } from "next/server"
import { extractProfileV4, PROFILE_V4_STAMP } from "../_v4/extractProfileV4"

export const ROUTE_V4_DEBUG_STAMP = "ROUTE_V4_DEBUG_STAMP__CLEAN_REWRITE"

console.log(`[jobfit-v4-debug route] loaded: ${ROUTE_V4_DEBUG_STAMP}`)

type Payload = {
    job_text?: unknown
    resume_text?: unknown
}

function isNonEmptyString(x: unknown): x is string {
    return typeof x === "string" && x.trim().length > 0
}

function isDev(): boolean {
    return process.env.NODE_ENV !== "production"
}

export async function POST(req: Request) {
    const requestStamp = {
        route_stamp: ROUTE_V4_DEBUG_STAMP,
        profile_v4_stamp: PROFILE_V4_STAMP,
    }

    try {
        const body = (await req.json()) as Payload

        const jobText = isNonEmptyString(body?.job_text) ? body.job_text.trim() : ""
        const resumeText = isNonEmptyString(body?.resume_text) ? body.resume_text : ""

        if (jobText.length < 50) {
            return NextResponse.json(
                {
                    ok: false,
                    ...requestStamp,
                    error: {
                        message: "job_text must be at least 50 characters",
                        received_length: jobText.length,
                    },
                },
                { status: 400 }
            )
        }

        // resume is optional per requirement
        const profile = extractProfileV4(resumeText)

        return NextResponse.json({
            ok: true,
            ...requestStamp,
            job_text_length: jobText.length,
            resume_text_length: resumeText.length,
            profile,
        })
    } catch (err: any) {
        const message = err?.message ?? "Unknown error"
        const stack = err?.stack ?? null

        // Never swallow in dev: return full payload
        const payload = {
            ok: false,
            ...requestStamp,
            error: {
                message,
                stack: isDev() ? stack : undefined,
            },
        }

        // Also log it so it shows up in terminal
        console.error("[jobfit-v4-debug route] 500 error:", err)

        return NextResponse.json(payload, { status: 500 })
    }
}