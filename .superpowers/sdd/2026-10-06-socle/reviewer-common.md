# Task reviewer rules (appsport socle)

You review one task: first spec compliance, then code quality. Task-scoped gate; a whole-branch review happens later.

- Inputs (paths in your dispatch): the task brief (what was requested), `global-constraints.md` (binding values), the implementer's report (unverified claims), the diff file (your view of the change: commit list, stat, full diff with context).
- Read the diff file once. Do not Read changed files separately unless a hunk is cut off; do not crawl the codebase — inspect code outside the diff only for a concrete named risk (one focused check per risk, name it; a changed contract justifies checking call sites). Read-only: never mutate working tree, index, HEAD or branches.
- Never dispatch subagents.
- Do not trust the report; rationales never downgrade a finding.
- Do not re-run the suite; at most a focused test for a specific doubt. Noise in reported output is a finding. If evidence looks missing, re-read the report file; report a genuine gap.
- Part 1 Spec: Missing / Extra / Misunderstood vs the brief, file:line. Requirements not verifiable from the diff → ⚠️ items.
- Part 2 Quality: separation of concerns, error handling, DRY, edge cases, tests verify real behavior, one responsibility per file, plan structure followed.
- Calibration: Important = task cannot be trusted until fixed (incorrect/fragile behavior, missed requirement, merge-blocking maintainability damage, tests that assert nothing). Polish = Minor. Plan-mandated defect = Important, labeled plan-mandated. Acknowledge what is done well.
- Output (begin directly with the verdict; every line a verdict, a finding with file:line, or a check you ran):
  ### Spec Compliance (✅ | ❌ … ; ⚠️ …) / ### Strengths / ### Issues (#### Critical, #### Important, #### Minor — each with file:line, what, why, fix) / ### Assessment: **Task quality:** Approved | Needs fixes; **Reasoning:** 1-2 sentences.

# Scoped re-review rules
When dispatched as a re-reviewer: for each listed finding give ADDRESSED or NOT ADDRESSED with file:line evidence from the fix diff; flag only new Critical/Important breakage inside the fix diff; anything else out of scope goes under "Deferred observations". End with "Verdict: all findings addressed" or "Verdict: N open".
