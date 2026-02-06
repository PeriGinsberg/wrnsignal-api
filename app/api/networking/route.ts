import { getAuthedProfileText } from "../_lib/authProfile"
import OpenAI from "openai"
import { corsOptionsResponse, withCorsJson } from "@/app/_lib/cors"

export const runtime = "nodejs"

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: Request) {
  try {
    // ✅ Auth + stored profile (server-side)
    const { profileText } = await getAuthedProfileText(req)
    const profile = profileText

    // ✅ Client sends only { job }
    const body = await req.json()
    const job = String(body?.job || "").trim()

    if (!job) {
      return withCorsJson(req, { error: "Missing job" }, 400)
    }

    const system = `
You are WRNSignal (Networking module).

RULES:
- Users can generate networking anytime, but reinforce that networking is post-apply.
- Generate EXACTLY three networking actions.
- Each action must include:
  - "target": who to contact (role/function)
  - "rationale": why that person is the right target
  - "message": a cut-and-paste message (warm + direct, not cringe, not a job ask)
- Message MUST:
  - state they applied to the role
  - ask for 10 minutes to learn about team/company and advice to stand out
  - be appropriately aggressive (no fluff)
- Reinforce: ~20% applying, ~80% networking after applying.

OUTPUT:
Return valid JSON ONLY:
{
  "note": string,
  "actions": [
    { "target": string, "rationale": string, "message": string },
    { "target": string, "rationale": string, "message": string },
    { "target": string, "rationale": string, "message": string }
  ]
}
    `.trim()

    const user = `
CLIENT PROFILE:
${profile}

JOB DESCRIPTION:
${job}

Generate exactly 3 networking actions. Choose smart targets (recruiter if appropriate, hiring team adjacent, someone in function/team).
Return JSON only.
    `.trim()

    const resp = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    })

    // @ts-ignore
    const raw = (resp as any).output_text || ""
    const parsed = safeJsonParse(raw)

    if (!parsed) {
      return withCorsJson(
        req,
        {
          note:
            "Networking is where you win. Treat applying as ~20% effort and networking as ~80% effort after you apply.",
          actions: [
            {
              target: "Model did not return JSON",
              rationale: "Retry.",
              message: raw || "Non-JSON response.",
            },
            { target: "", rationale: "", message: "" },
            { target: "", rationale: "", message: "" },
          ],
        },
        200
      )
    }

    const out: any = {
      note:
        typeof (parsed as any).note === "string"
          ? String((parsed as any).note)
          : "Networking is where you win. Treat applying as ~20% effort and networking as ~80% effort after you apply.",
      actions: Array.isArray((parsed as any).actions) ? (parsed as any).actions.slice(0, 3) : [],
    }

    // Ensure exactly 3 actions in output
    while (out.actions.length < 3) {
      out.actions.push({ target: "", rationale: "", message: "" })
    }
    out.actions = out.actions.slice(0, 3)

    return withCorsJson(req, out, 200)
  } catch (err: any) {
    const detail = err?.message || String(err)

    const lower = String(detail).toLowerCase()
    const status =
      lower.includes("unauthorized")
        ? 401
        : lower.includes("profile not found")
          ? 404
          : lower.includes("access disabled")
            ? 403
            : 500

    return withCorsJson(req, { error: "Networking failed", detail }, status)
  }
}
