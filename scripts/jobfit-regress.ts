import fs from "node:fs";
import path from "node:path";

type JobFitResponse = {
  decision?: string;
  score?: number;
  risk_flags?: string[];
  [k: string]: unknown;
};

type CaseFile = {
  id: string;
  input: Record<string, unknown>;
  expect: {
    decision?: string;
    minScore?: number;
    maxScore?: number;
    mustIncludeRiskFlags?: string[];
    mustNotIncludeRiskFlags?: string[];
  };
};

const ROOT = process.cwd();
const CASES_DIR = path.join(ROOT, "jobfit_tests", "cases");
const OUTPUT_DIR = path.join(ROOT, "jobfit_test_output");

const BASE_URL = process.env.JOBFIT_BASE_URL || "http://localhost:3000";
const ENDPOINT = `${BASE_URL}/api/jobfit`;
const TEST_KEY = process.env.JOBFIT_TEST_KEY || "";

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function listCaseFiles() {
  if (!fs.existsSync(CASES_DIR)) die(`Missing cases dir: ${CASES_DIR}`);
  return fs
    .readdirSync(CASES_DIR)
    .filter((f) => f.toLowerCase().endsWith(".json"))
    .map((f) => path.join(CASES_DIR, f));
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function includesAll(haystack: string[], needles: string[]) {
  const set = new Set(haystack);
  return needles.filter((n) => !set.has(n));
}

async function postJobFit(input: Record<string, unknown>): Promise<{ status: number; json?: JobFitResponse; text?: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (TEST_KEY) headers["x-jobfit-test-key"] = TEST_KEY;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });

  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    return { status: res.status, text: await res.text() };
  }
  return { status: res.status, json: (await res.json()) as JobFitResponse };
}

function evaluateCase(tc: CaseFile, actual: JobFitResponse) {
  const failures: string[] = [];

  if (tc.expect.decision && actual.decision !== tc.expect.decision) {
    failures.push(`decision expected "${tc.expect.decision}" got "${actual.decision}"`);
  }

  const score = typeof actual.score === "number" ? actual.score : null;

  if (typeof tc.expect.minScore === "number") {
    if (score === null) failures.push(`score missing, expected >= ${tc.expect.minScore}`);
    else if (score < tc.expect.minScore) failures.push(`score ${score} < minScore ${tc.expect.minScore}`);
  }

  if (typeof tc.expect.maxScore === "number") {
    if (score === null) failures.push(`score missing, expected <= ${tc.expect.maxScore}`);
    else if (score > tc.expect.maxScore) failures.push(`score ${score} > maxScore ${tc.expect.maxScore}`);
  }

  const riskFlags = Array.isArray(actual.risk_flags) ? actual.risk_flags : [];

  if (tc.expect.mustIncludeRiskFlags?.length) {
    const missing = includesAll(riskFlags, tc.expect.mustIncludeRiskFlags);
    if (missing.length) failures.push(`missing risk_flags: ${missing.join(" | ")}`);
  }

  if (tc.expect.mustNotIncludeRiskFlags?.length) {
    const set = new Set(riskFlags);
    const found = tc.expect.mustNotIncludeRiskFlags.filter((x) => set.has(x));
    if (found.length) failures.push(`unexpected risk_flags present: ${found.join(" | ")}`);
  }

  return failures;
}

async function main() {
  if (!TEST_KEY) {
    console.warn("WARNING: JOBFIT_TEST_KEY is not set in this terminal. The server might still have it in .env.local, but your curl bypass header will be empty.");
  }

  ensureOutputDir();

  const files = listCaseFiles();
  if (!files.length) die(`No test cases found in ${CASES_DIR}`);

  console.log(`Running ${files.length} JobFit cases against ${ENDPOINT}`);

  let pass = 0;
  let fail = 0;
  const results: any[] = [];

  for (const f of files) {
    const tc = readJson<CaseFile>(f);

    const t0 = Date.now();
    const res = await postJobFit(tc.input);
    const ms = Date.now() - t0;

    if (res.status !== 200 || !res.json) {
      fail++;
      console.log(`❌ ${tc.id} (${ms}ms) HTTP ${res.status}`);
      if (res.text) console.log(res.text.slice(0, 500));
      results.push({ id: tc.id, ok: false, status: res.status, error: res.text ?? "Non-JSON response" });
      continue;
    }

    const failures = evaluateCase(tc, res.json);

    if (failures.length) {
      fail++;
      console.log(`❌ ${tc.id} (${ms}ms)`);
      for (const x of failures) console.log(`   - ${x}`);
      results.push({ id: tc.id, ok: false, failures, actual: res.json });
    } else {
      pass++;
      console.log(`✅ ${tc.id} (${ms}ms)`);
      results.push({ id: tc.id, ok: true, actual: res.json });
    }
  }

  const report = {
    endpoint: ENDPOINT,
    total: files.length,
    pass,
    fail,
    at: new Date().toISOString(),
    results,
  };

  const outFile = path.join(OUTPUT_DIR, `jobfit_regress_${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf-8");

  console.log("");
  console.log(`Done. Pass: ${pass} Fail: ${fail}`);
  console.log(`Report: ${outFile}`);

 if (fail) throw new Error(`Regression failures: ${fail}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
