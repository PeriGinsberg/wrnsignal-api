## real-020 — Apply — CORRECT

Notes:
- Strong direct alignment across core functions
- No risks surfaced
- Score consistent with Apply

Engine Issues (log only):
- Irrelevant requirement keys detected:
  - hospital_or_environment
  - financial_analysis
- Requirement extraction contamination from unrelated job text

## real-101 — Review — WRONG (should be Apply)

Notes:
- Strong clinical alignment (EMT + OR exposure) directly matches role intent
- Relevant early sales experience (pipeline + closed deals) is present
- This is a prototypical entry-level clinical sales hire profile

Engine Issues:
- Over-penalizing lack of direct territory execution in early-career candidates
- Not properly recognizing clinical + sales hybrid profiles as sufficient for Apply
- Duplicate risk generation for same requirement (territory_execution appears twice)
- Adjacent sales evidence (pipeline + closing) undervalued for entry-level roles

Fix Direction (later):
- Introduce role-level expectation scaling (entry-level vs experienced)
- Collapse duplicate risks at requirement-key level
- Adjust weighting: clinical + sales combo should clear Apply threshold for this job family

## real-102 — Review — WRONG (should be Apply)

Notes:
- Strong direct alignment with design role (brand identity + content execution)
- All required tools present (Adobe suite)
- No meaningful risks

Engine Issues:
- Job incorrectly classified as Finance instead of Design/Marketing
- Requirement extraction pulling irrelevant signals:
  - financial_analysis
  - analysis_reporting overweighted for a design role
- Tool-based roles not getting sufficient credit toward Apply threshold
- Preferred tools (Excel, Word) incorrectly treated as meaningful risks

Fix Direction (later):
- Fix job family classification (Design ? Finance)
- Reduce weight of reporting/analytics in creative roles
- Prevent preferred tools from generating real risk weight
