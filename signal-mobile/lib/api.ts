/**
 * SIGNAL API Client
 *
 * All calls go to the Vercel-hosted backend. Bearer token is injected
 * automatically. Uses the same postJsonWithDebug pattern as the web app
 * for consistent error handling and debug logging.
 */

const API_BASE = "https://wrnsignal-api.vercel.app";

/* ── Transport layer ────────────────────────────────────────── */

function safePreview(s: string, max = 1400): string {
  const t = (s || "").trim();
  return t.length > max ? t.slice(0, max) + "\n…(truncated)" : t;
}

function looksLikeHtml(text: string): boolean {
  const t = (text || "").trim().toLowerCase();
  return (
    t.startsWith("<!doctype") ||
    t.startsWith("<html") ||
    t.includes("<head") ||
    t.includes("<body")
  );
}

export type DebugInfo = {
  stage: "fetch_throw" | "fetch_response";
  url: string;
  ms: number;
  status?: number;
  ok?: boolean;
  contentType?: string;
  responsePreview?: string;
  errorName?: string;
  errorMessage?: string;
};

/**
 * POST JSON to an API endpoint with debug logging.
 * Mirrors the web app's postJsonWithDebug exactly.
 */
async function postJsonWithDebug(
  url: string,
  payload: unknown,
  accessToken: string,
  onDebug?: (d: DebugInfo) => void
): Promise<any> {
  const startedAt = Date.now();
  let res: Response;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };

  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (err: any) {
    const info: DebugInfo = {
      stage: "fetch_throw",
      url,
      ms: Date.now() - startedAt,
      errorName: err?.name,
      errorMessage: err?.message,
    };
    onDebug?.(info);
    console.warn("[api] fetch_throw", info);
    throw new Error("Request failed. Please try again.");
  }

  const ms = Date.now() - startedAt;
  const contentType = res.headers.get("content-type") || "";
  const raw = await res.text();

  const info: DebugInfo = {
    stage: "fetch_response",
    url,
    ms,
    status: res.status,
    ok: res.ok,
    contentType,
    responsePreview: safePreview(raw),
  };
  onDebug?.(info);
  if (!res.ok) console.warn("[api] fetch_response", info);

  if (looksLikeHtml(raw) || contentType.includes("text/html")) {
    throw new Error("Unexpected response. Please try again.");
  }

  let data: any = null;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Unexpected response. Please try again.");
  }

  if (!res.ok) {
    throw new Error(
      data?.detail || data?.error || "Request failed. Please try again."
    );
  }

  return data;
}

/**
 * GET JSON from an API endpoint with auth header.
 */
async function getJsonWithAuth(
  url: string,
  accessToken: string
): Promise<any> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const raw = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(raw);
    } catch {}
    throw new Error(
      data?.detail || data?.error || `Request failed (${res.status}).`
    );
  }

  return res.json();
}

/* ── Response types ─────────────────────────────────────────── */

/** JobFit result — the shape after normalization. */
export type JobFitResult = {
  decision: string;
  score?: number;
  next_step?: string;
  why_codes?: Array<{
    code: string;
    note?: string;
    weight?: number;
    profile_fact?: string;
    job_fact?: string;
    match_strength?: string;
  }>;
  risk_codes?: Array<{
    code: string;
    risk?: string;
    severity?: string;
    job_fact?: string;
  }>;
  bullets?: string[];
  risk?: string[];
  risk_structured?: Array<{
    reframe: string;
    keyword: string;
  }>;
  gate_triggered?: { type: string; detail?: string };
  job_signals?: {
    internship?: { isInternship: boolean };
    location?: { mode: string; city?: string };
    yearsRequired?: number | null;
    jobTitle?: string;
    companyName?: string;
  };
  job_title?: string;
  company?: string;
};

/** Positioning result. */
export type PositioningResult = {
  result?: {
    student_intro?: string;
    studentIntro?: string;
    primary_match_drivers?: string[];
    primaryMatchDrivers?: string[];
    role_angle?: { evidence?: string[] };
    resume_bullet_edits?: Array<{
      before?: string;
      before_bullet?: string;
      after?: string;
      after_bullet?: string;
      why?: string;
      rationale?: string;
    }>;
    resumeBulletEdits?: any[];
    bullet_edits?: any[];
    bulletEdits?: any[];
    summary_statement?: any;
    summaryStatement?: any;
  };
};

/** Cover letter result. */
export type CoverLetterResult = {
  letter: string;
  contact?: {
    full_name?: string;
    phone?: string;
    email?: string;
  };
  full_name?: string;
  name?: string;
  student_name?: string;
  studentName?: string;
  phone?: string;
  email?: string;
};

/** Networking result. */
export type NetworkingResult = {
  framing?: string;
  strategy?: string;
  sequence?: any[];
  moves?: Array<{
    target_title?: string;
    targetTitle?: string;
    goal?: string;
    why_this_target?: string;
    timing?: string;
    channel_plan?: { primary?: string };
    linkedin_connection_request?: string;
    linkedin_message?: string;
    email_subject?: string;
    email_body?: string;
    follow_up_message?: string;
    linkedin_search_queries?: string[];
    conversation_openers?: string[];
  }>;
};

/** Persona from /api/personas. */
export type Persona = {
  id: string;
  name: string;
  resume_text: string;
  is_default: boolean;
  display_order: number;
  persona_version: number;
};

/* ── API functions ──────────────────────────────────────────── */

/**
 * Run JobFit analysis.
 *
 * POST /api/jobfit
 * Body: { job: string, job_title: string, company_name: string, persona_id?: string }
 *
 * job_title and company_name are required by the server as of the
 * 2026-04 backend change. The scoring engine uses the user-provided
 * values for title-based family inference and target-role matching
 * instead of trying to parse them out of the JD body, which was
 * unreliable on short or company-heavy postings.
 */
export async function runJobFit(
  accessToken: string,
  job: string,
  jobTitle: string,
  companyName: string,
  personaId?: string | null,
  onDebug?: (d: DebugInfo) => void
): Promise<JobFitResult> {
  const payload: Record<string, unknown> = {
    job: job.trim(),
    job_title: jobTitle.trim(),
    company_name: companyName.trim(),
  };
  if (personaId) payload.persona_id = personaId;

  const data = await postJsonWithDebug(
    `${API_BASE}/api/jobfit`,
    payload,
    accessToken,
    onDebug
  );

  // Normalize: API sometimes wraps in { result: ... }
  if (data && typeof data === "object" && "result" in data && data.result) {
    return data.result as JobFitResult;
  }
  return data as JobFitResult;
}

/**
 * Run Positioning analysis.
 *
 * POST /api/positioning
 * Body: { job: string }
 */
export async function runPositioning(
  accessToken: string,
  job: string,
  onDebug?: (d: DebugInfo) => void
): Promise<PositioningResult> {
  return postJsonWithDebug(
    `${API_BASE}/api/positioning`,
    { job: job.trim() },
    accessToken,
    onDebug
  );
}

/**
 * Run Cover Letter generation.
 *
 * POST /api/coverletter
 * Body: { job: string, jobfit_result?: JobFitResult | null }
 */
export async function runCoverLetter(
  accessToken: string,
  job: string,
  jobfitResult?: JobFitResult | null,
  onDebug?: (d: DebugInfo) => void
): Promise<CoverLetterResult> {
  return postJsonWithDebug(
    `${API_BASE}/api/coverletter`,
    { job: job.trim(), jobfit_result: jobfitResult ?? null },
    accessToken,
    onDebug
  );
}

/**
 * Run Networking plan generation.
 *
 * POST /api/networking
 * Body: { job: string }
 */
export async function runNetworking(
  accessToken: string,
  job: string,
  onDebug?: (d: DebugInfo) => void
): Promise<NetworkingResult> {
  return postJsonWithDebug(
    `${API_BASE}/api/networking`,
    { job: job.trim() },
    accessToken,
    onDebug
  );
}

/**
 * Load user personas.
 *
 * GET /api/personas
 * Returns array of personas.
 */
export async function loadPersonas(
  accessToken: string
): Promise<Persona[]> {
  const data = await getJsonWithAuth(
    `${API_BASE}/api/personas`,
    accessToken
  );
  // API returns { personas: [...] } or bare array
  const list = Array.isArray(data) ? data : (data.personas ?? []);
  return list as Persona[];
}

/* ── Profile ────────────────────────────────────────────────── */

export type Profile = {
  id: string;
  user_id: string | null;
  name: string | null;
  email: string | null;
  job_type: string | null;
  target_roles: string | null;
  target_locations: string | null;
  preferred_locations: string | null;
  timeline: string | null;
  resume_text: string | null;
  profile_text: string | null;
  profile_structured: Record<string, any> | null;
  profile_version: number;
  updated_at: string | null;
};

/**
 * GET /api/profile
 */
export async function getProfile(accessToken: string): Promise<Profile> {
  const data = await getJsonWithAuth(`${API_BASE}/api/profile`, accessToken);
  return (data.profile ?? data) as Profile;
}

/**
 * PUT /api/profile
 */
export async function updateProfile(
  accessToken: string,
  fields: Partial<Omit<Profile, "id" | "email" | "profile_version">>
): Promise<Profile> {
  const res = await fetch(`${API_BASE}/api/profile`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || `Profile update failed (${res.status}).`);
  }
  const data = await res.json();
  return (data.profile ?? data) as Profile;
}

/* ── Persona CRUD ───────────────────────────────────────────── */

/**
 * PUT /api/personas/:id
 */
export async function updatePersona(
  accessToken: string,
  id: string,
  fields: { name?: string; resume_text?: string; is_default?: boolean }
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/personas/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || "Persona update failed.");
  }
}

/**
 * DELETE /api/personas/:id
 */
export async function deletePersona(
  accessToken: string,
  id: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/personas/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || "Persona delete failed.");
  }
}

/**
 * POST /api/personas
 */
export async function createPersona(
  accessToken: string,
  name: string,
  resumeText: string
): Promise<Persona> {
  const res = await fetch(`${API_BASE}/api/personas`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ name, resume_text: resumeText }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Persona create failed.");
  return (data.persona ?? data) as Persona;
}

/* ── Applications (Job Tracker) ─────────────────────────────── */

export type Application = {
  id: string;
  company_name: string;
  job_title: string;
  location: string;
  application_status: string;
  applied_date: string | null;
  interest_level: number;
  signal_decision: string;
  signal_score: number | null;
  signal_run_at: string | null;
  notes: string;
  interview_count: number;
  persona_name: string | null;
  jobfit_run_id: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * GET /api/applications
 */
export async function getApplications(
  accessToken: string
): Promise<Application[]> {
  const data = await getJsonWithAuth(
    `${API_BASE}/api/applications`,
    accessToken
  );
  return (data.applications ?? []) as Application[];
}

/**
 * PUT /api/applications/:id
 */
export async function updateApplication(
  accessToken: string,
  id: string,
  fields: Partial<Application>
): Promise<Application> {
  const res = await fetch(`${API_BASE}/api/applications/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(fields),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Application update failed.");
  return (data.application ?? data) as Application;
}

/* ── Interviews ─────────────────────────────────────────────── */

export type Interview = {
  id: string;
  application_id: string;
  company_name: string;
  job_title: string;
  interview_stage: string;
  interviewer_names: string;
  interview_date: string | null;
  thank_you_sent: boolean;
  status: string;
  confidence_level: number;
  notes: string;
  created_at: string;
};

/**
 * GET /api/interviews — returns all interviews for the user.
 */
export async function getInterviews(
  accessToken: string
): Promise<Interview[]> {
  const data = await getJsonWithAuth(
    `${API_BASE}/api/interviews`,
    accessToken
  );
  return (data.interviews ?? []) as Interview[];
}

/**
 * POST /api/interviews
 */
/* ── Resume Upload ──────────────────────────────────────────── */

/**
 * POST /api/resume-upload
 * Uploads a PDF, DOCX, or TXT file and returns extracted text.
 */
export async function uploadResume(
  accessToken: string,
  fileUri: string,
  fileName: string,
  mimeType: string
): Promise<string> {
  const formData = new FormData();
  formData.append("file", {
    uri: fileUri,
    name: fileName,
    type: mimeType,
  } as any);

  const res = await fetch(`${API_BASE}/api/resume-upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || "Resume upload failed.");
  }
  return data.text as string;
}

export async function createInterview(
  accessToken: string,
  fields: {
    application_id: string;
    interview_stage: string;
    interview_date?: string;
    status?: string;
    confidence_level?: number;
    notes?: string;
  }
): Promise<Interview> {
  const res = await fetch(`${API_BASE}/api/interviews`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(fields),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Interview create failed.");
  return (data.interview ?? data) as Interview;
}
