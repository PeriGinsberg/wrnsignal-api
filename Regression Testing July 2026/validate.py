#!/usr/bin/env python3
"""
SIGNAL golden-set tooling.

Two commands:

  python3 validate.py            # lint the set: inputs exist, ids/verdicts legal
  python3 validate.py --run      # cold-run all cases through your engine + grade

To wire it to the real engine, implement score_resume() below. Everything else
is done. `validate.py` (no flags) needs no engine and should pass right now.
"""
# KNOWN CAVEAT — profile-augmentation fidelity gap (accepted, not a bug):
#   Prod's paid JobFit scores an AUGMENTED profile: assembleProfileForScoring
#   prepends a SIGNAL block (target roles/families, YOE, location prefs) pulled
#   from the candidate's client_profiles row before runJobFit sees it. The
#   golden set deliberately scores the BARE cold input (resume + posting only) —
#   there is no client_profiles metadata to augment with. So family inference
#   here can differ from a real prod run for the same resume. This is by design
#   (cold, reproducible). If a baseline verdict looks off, check this first
#   before suspecting the engine.
import sys, re, os, json, subprocess, pathlib

try:
    import yaml
except ImportError:
    sys.exit("need pyyaml: pip install pyyaml")

ROOT = pathlib.Path(__file__).parent
REPO_ROOT = ROOT.parent                       # C:\Users\perig\wrnsignal-api
BRIDGE = ROOT / "_engine_bridge.ts"           # thin tsx adapter -> runJobFit
VERDICTS = {"APPLY", "REVIEW", "PASS"}
SEVERITY = {"LOW": 1, "MEDIUM": 2, "HIGH": 3}
VOCAB = {
    "domain_gap", "ownership_via_contribution_verbs", "crm_pipeline_absent",
    "revenue_metrics_absent", "people_mgmt_absent", "scope_inversion",
    "adjacency_inflation", "hard_credential_absent", "seniority_gap",
    "stale_skill", "unsupported_skill_claim", "preferred_item_missing",
}


def load():
    return yaml.safe_load((ROOT / "expected.yaml").read_text(encoding="utf-8"))["cases"]


def lint(cases):
    errs = []
    for cid, c in cases.items():
        inp = ROOT / "cases" / f"case-{cid}.input.md"
        if not inp.exists():
            errs.append(f"[{cid}] missing input file {inp.name}")
        if c["expected_verdict"] not in VERDICTS:
            errs.append(f"[{cid}] bad expected_verdict {c['expected_verdict']!r}")
        for v in c.get("must_not_be", []):
            if v not in VERDICTS:
                errs.append(f"[{cid}] bad must_not_be {v!r}")
        if c["expected_verdict"] in c.get("must_not_be", []):
            errs.append(f"[{cid}] expected_verdict is also in must_not_be")
        for r in c.get("risks", []):
            if r["id"] not in VOCAB:
                errs.append(f"[{cid}] risk id {r['id']!r} not in VOCAB")
            if r["min_severity"] not in SEVERITY:
                errs.append(f"[{cid}] bad severity {r['min_severity']!r}")
    return errs


# --- wire this to SIGNAL ------------------------------------------------------
#
# The real engine is the deterministic TS orchestrator
# app/api/_lib/jobfitEvaluator.ts :: runJobFit({ profileText, jobText,
# userJobTitle?, userCompanyName?, ... }). Python reaches it through the thin
# _engine_bridge.ts adapter (stdin JSON -> runJobFit -> one stdout JSON line).
#
# MAPPING engine output -> harness shape (see the report for the full rationale;
# the short version is inline here so the translation is auditable):
#
#   verdict: the engine's 4-level Decision collapses to the 3-level scale.
#            Priority Apply + Apply -> APPLY. Faithful.
_VERDICT = {
    "Priority Apply": "APPLY",
    "Apply": "APPLY",
    "Review": "REVIEW",
    "Pass": "PASS",
}

#   risks: engine RISK_* codes -> golden-set VOCAB ids. CONSERVATIVE — only
#          mappings that are a genuine semantic match are listed. The engine
#          has NO emitter for 7 of the 12 VOCAB ids (ownership_via_contribution_
#          verbs, crm_pipeline_absent, revenue_metrics_absent, people_mgmt_
#          absent, scope_inversion, adjacency_inflation, stale_skill) — those
#          are the defects this set hunts, so they are intentionally absent
#          rather than faked. A fabricated flag would defeat the set-by-id check.
_RISK_MAP = {
    "RISK_DOMAIN_EXPERIENCE": "domain_gap",
    "RISK_FAMILY_MISMATCH": "domain_gap",
    "RISK_SENIORITY_MISMATCH": "seniority_gap",
    "RISK_EXPERIENCE": "seniority_gap",
    "RISK_MISSING_PROOF": "unsupported_skill_claim",
    "RISK_LIMITED_MATCH_EVIDENCE": "unsupported_skill_claim",
    "RISK_MISSING_TOOLS": "unsupported_skill_claim",
    "RISK_CREDENTIAL_PREFERRED": "preferred_item_missing",
    "RISK_DEGREE": "hard_credential_absent",
    "RISK_MBA": "hard_credential_absent",
    "RISK_OWNERSHIP_VERB_MISMATCH": "ownership_via_contribution_verbs",  # defect #2
    "RISK_DOMAIN_GAP": "domain_gap",                                     # defect #3
    "RISK_CRM_ABSENT": "crm_pipeline_absent",
    "RISK_REVENUE_METRICS_ABSENT": "revenue_metrics_absent",
    "RISK_STALE_SKILL": "stale_skill",
    "RISK_PEOPLE_MGMT_ABSENT": "people_mgmt_absent",
    "RISK_SCOPE_INVERSION": "scope_inversion",
    "RISK_ADJACENCY_INFLATION": "adjacency_inflation",
    "RISK_HARD_CREDENTIAL_ABSENT": "hard_credential_absent",
    "RISK_PREFERRED_ITEM_MISSING": "preferred_item_missing",
}
# A force_pass on a credential/MBA wall is the hard form of hard_credential_absent.
_GATE_HARD_CREDENTIAL = {"GATE_CREDENTIAL_REQUIRED", "GATE_MBA_REQUIRED"}
_SEV_UP = {"low": "LOW", "medium": "MEDIUM", "high": "HIGH"}
_SEV_RANK = {"LOW": 1, "MEDIUM": 2, "HIGH": 3}


def _split_input(md: str):
    """Cold input -> (profile_text, job_text, user_job_title, user_company).

    The engine sees ONLY this md. Split it on the two section headers the case
    files use ('## RESUME' ... '## JOB POSTING'). Title/company are parsed from
    the posting header and passed as user overrides — mirroring the real product
    flow, where the user-entered title/company feed family inference BEFORE
    scoring (jobfitEvaluator applies userJobTitle/userCompanyName pre-score).
    """
    parts = re.split(r"(?im)^\s*##\s*JOB\s+POSTING\s*$", md, maxsplit=1)
    resume_part, job_part = parts[0], (parts[1] if len(parts) > 1 else "")

    m = re.search(r"(?im)^\s*##\s*RESUME\s*$", resume_part)
    resume_body = resume_part[m.end():] if m else resume_part
    resume_body = re.sub(r"\n-{3,}\s*$", "\n", resume_body).strip()   # drop trailing '---'
    job_body = job_part.strip()

    title = company = None
    tm = re.search(r"\*\*(.+?)\*\*", job_body)                        # first bold = title
    if tm:
        title = tm.group(1).strip()
        nxt = job_body[tm.end():].lstrip("\n").split("\n", 1)[0]      # line under it
        company = (re.split(r"\s[—–-]\s|\s*\|\s*", nxt, maxsplit=1)[0].strip() or None)

    # 'Resume:\n' prefix matches the engine's resume-block convention (the same
    # shape the in-repo regression harness feeds via profile_text + 'Resume:').
    return "Resume:\n" + resume_body, job_body, title, company


def _call_engine(profile_text, job_text, title, company) -> dict:
    """Run the cold split through the TS bridge; return the raw engine dict."""
    payload = json.dumps({
        "profileText": profile_text,
        "jobText": job_text,
        "userJobTitle": title,
        "userCompanyName": company,
    })
    npx = "npx.cmd" if os.name == "nt" else "npx"     # resolve npx on Windows
    proc = subprocess.run(
        [npx, "tsx", str(BRIDGE)],
        input=payload, capture_output=True,
        # Force UTF-8 decode with replacement. On Windows text=True would decode
        # the engine's stdout/stderr as cp1252 and crash on non-Latin-1 bytes
        # (em-dashes, smart quotes) from the JD/engine output.
        encoding="utf-8", errors="replace",
        cwd=str(REPO_ROOT),                            # so tsconfig '@/' aliases resolve
    )
    line = next((ln for ln in proc.stdout.splitlines() if "__SIGNAL_JSON__" in ln), None)
    if line is None:
        raise RuntimeError(
            "engine bridge produced no JSON (rc=%s)\n--- stdout ---\n%s\n--- stderr ---\n%s"
            % (proc.returncode, proc.stdout[-2000:], proc.stderr[-2000:])
        )
    return json.loads(line.split("__SIGNAL_JSON__", 1)[1])


def score_resume(input_md: str) -> dict:
    """Send the cold input to the engine. Return normalized:
        {"verdict": "APPLY|REVIEW|PASS",
         "gates":   {"gate_id": "MET|UNMET|UNKNOWN", ...},
         "risks":   [{"id": "<vocab id>", "severity": "LOW|MEDIUM|HIGH"}, ...],
         "your_move": "<the advice string>"}
    """
    profile_text, job_text, title, company = _split_input(input_md)
    raw = _call_engine(profile_text, job_text, title, company)

    verdict = _VERDICT[raw["decision"]]

    # risks: translate + dedupe by vocab id, keeping the highest severity seen.
    risks: dict[str, str] = {}
    def _raise(vid, sev):
        if vid not in risks or _SEV_RANK[sev] > _SEV_RANK[risks[vid]]:
            risks[vid] = sev
    for rc in raw.get("risk_codes", []):
        vid = _RISK_MAP.get(rc.get("code"))
        if vid:
            _raise(vid, _SEV_UP.get(str(rc.get("severity", "")).lower(), "LOW"))
    gate = raw.get("gate_triggered") or {}
    if gate.get("type") == "force_pass" and gate.get("gateCode") in _GATE_HARD_CREDENTIAL:
        _raise("hard_credential_absent", "HIGH")

    # gates: read from the engine's per-requirement gate ledger (defect #1,
    # surfaced on EvalOutput when runJobFit runs with applyGateLedger:true — the
    # bridge enables it). Only REQUIRED gates are asserted; preferred entries
    # never appear here. Empty when the ledger is absent/off.
    gates: dict[str, str] = {
        e["gate_id"]: e["status"]
        for e in (raw.get("gate_ledger") or [])
        if e.get("required")
    }

    # your_move: the decision next-step PLUS the rendered WHY bullets. The
    # your_move_must_not checks target how evidence is *framed* in the advice,
    # and that framing lives in the WHY bullets, not the generic next_step.
    your_move = "\n".join([raw.get("next_step", "")] + raw.get("bullets", [])).strip()

    return {
        "verdict": verdict,
        "gates": gates,
        "risks": [{"id": vid, "severity": sev} for vid, sev in risks.items()],
        "your_move": your_move,
    }
# ------------------------------------------------------------------------------


def grade(cid, c, out):
    fails = []
    v = out["verdict"]
    if v in c.get("must_not_be", []):
        fails.append(f"verdict {v} is forbidden (must_not_be)")
    if c.get("discriminator") and v != c["expected_verdict"]:
        fails.append(f"discriminator: got {v}, need exactly {c['expected_verdict']}")
    for gid, status in c.get("gates", {}).items():
        if out.get("gates", {}).get(gid) != status:
            fails.append(f"gate {gid}: got {out.get('gates',{}).get(gid)}, need {status}")
    got = {r["id"]: SEVERITY[r["severity"]] for r in out.get("risks", [])}
    for r in c.get("risks", []):
        need = SEVERITY[r["min_severity"]]
        if r["id"] not in got:
            fails.append(f"missing risk {r['id']} (>= {r['min_severity']})")
        elif got[r["id"]] < need:
            fails.append(f"risk {r['id']} severity too low (< {r['min_severity']})")
    # risks that MUST NOT fire — a false-fire regression guard (case 10). If any
    # listed risk id is present, that is a HARD failure.
    for rid in c.get("risks_must_not_fire", []):
        if rid in got:
            fails.append(f"risk {rid} MUST NOT fire but did")
    ym = (out.get("your_move") or "").lower()
    for bad in c.get("your_move_must_not", []):
        # substring heuristic; tighten per your advice format
        key = re.sub(r"[^a-z ]", "", bad.lower())
        if key and key in ym:
            fails.append(f"your_move violated: {bad!r}")
    return fails


def main():
    cases = load()
    errs = lint(cases)
    if errs:
        print("LINT FAILED:")
        for e in errs:
            print("  " + e)
        sys.exit(1)
    print(f"lint ok — {len(cases)} cases, all inputs present, ids/verdicts legal")

    if "--run" not in sys.argv:
        print("cold-run manifest (files the engine may see):")
        for cid in cases:
            print(f"  case {cid} -> cases/case-{cid}.input.md")
        print("run `python3 validate.py --run` once score_resume() is wired.")
        return

    total_fail = 0
    for cid, c in cases.items():
        # UTF-8 explicit: on Windows read_text() defaults to cp1252, which
        # mangles the em/en-dashes the gate regexes key on (e.g. "2022–Present").
        md = (ROOT / "cases" / f"case-{cid}.input.md").read_text(encoding="utf-8")
        out = score_resume(md)
        fails = grade(cid, c, out)
        tag = "PASS" if not fails else "FAIL"
        print(f"[{tag}] case {cid} {c['name']}  ->  {out['verdict']} (want {c['expected_verdict']})")
        for f in fails:
            print("       - " + f)
        total_fail += bool(fails)
    print(f"\n{len(cases)-total_fail}/{len(cases)} cases pass")
    sys.exit(1 if total_fail else 0)


if __name__ == "__main__":
    main()
