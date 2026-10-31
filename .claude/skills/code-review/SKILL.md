---
name: code-review
description: Review the Wolfchatter codebase as a skeptical outside reviewer. Use when asked to review, audit, or self-review the code, or before a release or submission. Produces docs/REVIEW.md.
---

# Code review

You are reviewing code you did not write. Assume it is plausible-looking but may be wrong: AI-generated code usually compiles and reads well, so the risk is in behavior, not syntax. Be skeptical, specific, and brief.

Run this in a fresh session or subagent, never in the session that wrote the code. Reviewing your own work in the same context mostly confirms it.

## Inputs to read first

1. `docs/PRD.md`: the requirements (FR1 to FR8) the code must satisfy.
2. `docs/DESIGN.md` and `CLAUDE.md`: the architecture rules the code must follow.
3. `.claude/skills/code-review/checklist.md`: what to check.

## Process

1. **Run the tools and record the results.** `npm run lint`, `npm run typecheck`, `npm test`, `npm run e2e`, `npm audit --omit=dev`. Include pass/fail and any failures verbatim in the report.
2. **Trace requirements.** For each of FR1 to FR8, name the code that implements it and the test that proves it. A requirement with no test is a finding.
3. **Work through the checklist** category by category. Read the code; do not skim file names.
4. **Verify before you report.** For every suspected bug, find the exact lines and a concrete scenario that triggers it. If you can, reproduce it with a failing test or a command. Drop findings you cannot support.
5. **Check docs against code.** Anything in the PRD, DESIGN, README, or CLAUDE.md that the code contradicts is a finding.
6. **Write `docs/REVIEW.md`** in the format below. Do not edit application code during the review. Fixing is a separate step.

## Rules

- Every finding needs: a file and line, what is wrong, the scenario where it fails, and a suggested fix.
- Do not report things lint or the formatter already enforce, or personal style preferences.
- Do not pad. Fewer, real findings beat a long list. If a category is clean, say so in one line.
- Mark your confidence honestly: High (reproduced or obvious from the code), Medium (reasoned, not reproduced), Low (suspicion).
- Never invent a file, function, or library behavior. If you are unsure how a library works, say so and point to what to check.

## Severity

- **Blocker**: data loss, security hole, a requirement not met, or the app does not run from a clean clone.
- **Major**: likely user-visible bug or a clear violation of the architecture rules.
- **Minor**: edge case, weak test, small maintainability issue.
- **Nit**: optional polish. Keep these to a short list at the end.

## Output format for `docs/REVIEW.md`

```
# Code review report

Reviewed: <commit hash> on <date>

## Summary
Two to four sentences: overall quality, the most important risks, and whether it is ready to submit.

## Automated checks
| Check | Result | Notes |

## Requirements traceability
| Requirement | Implemented in | Tested by | Status |

## Findings
| # | Severity | Confidence | Location | Problem and scenario | Suggested fix |

## Clean areas
One line per checklist category with no findings.

## Resolution note
(Left empty by the reviewer. The author fills it in after triage: what was fixed,
what was deliberately not fixed, and why.)
```

## After the review

The author triages every finding as Fix, Won't fix, or Defer, and completes the Resolution note. Won't fix needs a reason (low risk, out of scope for the PoC, cost greater than benefit). Fixes go in separate commits that reference the finding number.
