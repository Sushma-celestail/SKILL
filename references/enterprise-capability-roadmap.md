# Enterprise Capability Roadmap

Read this reference only for Enterprise Execution Mode, as defined in §57 of
`SKILL.md`. It is a capability roadmap for engineering and operating the skill;
it does not change the PRD-first architecture contract.

## Status Language

Use only the following evidence language in reports:

| State | Meaning |
|---|---|
| Specified | Requirement documented in the skill. |
| Implemented | Versioned supporting code/configuration exists. |
| Executed | The implementation ran for the current job/release. |
| Verified | Execution passed with recorded evidence. |
| Blocked | Required control could not run; impact and next action recorded. |
| Approved Deviation | Authorised exception with defined scope and expiry/review point. |

## Phase 1 — Baseline Audit

### Skill behaviour implemented

* The skill requires architecture versioning, validation, consistency checks,
  and downstream handoff.

### External capabilities required but not implemented by `SKILL.md`

```text
Baseline-audit report generator
Git comparison / change-diff process
Repository health check
Release changelog generator
```

### Completion evidence

```text
Baseline commit or release tag
Audit report with identified files, risks, and no-change/changed conclusion
Approved change record
```

## Phase 2 — Source Indexing and Context Efficiency

### Skill behaviour implemented

* §52 requires bounded reading and requirement-by-requirement extraction.
* §38 calibrates output depth.
* §52 step 36 requires returning to literal PRD source text to verify citations.

### External capabilities required but not implemented by `SKILL.md`

```text
index_prd.py or index_prd.js
Source-document hash calculator
Stale-path and missing-attachment detector
Token/context measurement collector, where runtime telemetry is available
Reusable structured requirement-inventory format
```

### Minimum index record

```json
{
  "source_locator": "",
  "requirement_id": "",
  "title": "",
  "type": "",
  "source_status": "",
  "module": "",
  "current_or_target": "",
  "open_question_ids": []
}
```

### Completion evidence

```text
Indexed source inventory
Source hash
Requirement count reconciliation
Stale-path test result
```

## Phase 3 — Tier Routing

### Skill behaviour implemented

* §38 supplies Tier 1/2/3 calibration criteria.

### Required refinement

Use this deterministic initial selection rule:

```text
Tier 3:
  6+ modules, OR 40+ significant requirements, OR migration plus 2+
  integrations, OR material multi-actor access/security/lifecycle scope.

Tier 2:
  Otherwise 11–39 significant requirements, OR 2–5 modules, OR a single
  material module with an integration, lifecycle, or security boundary.

Tier 1:
  Otherwise.
```

An expert override is permitted only when recorded with initial tier, selected
tier, source evidence, and reason. This prevents blind threshold-following
while keeping routing repeatable.

### Implemented external capabilities

```text
phase3/tier-routing.js — deterministic selection from a Phase 2 index or controlled routing input
Tier override validation — requires a materially justified reason and PRD evidence
phase3/fixtures/ — seven Tier 1/2/3 and override fixtures
phase3/run-tier-routing-tests.js — repeatable fixture runner and JSON/Markdown report
```

### Completion evidence

```text
Seven fixture results with expected initial and selected tiers
Tier-routing test report
Service Desk live Tier 3 routing record generated from its Phase 2 index
Override fixture containing initial tier, selected tier, reason, evidence, and approver
```

## Phase 4 — Verification and Regression Testing

### Skill behaviour implemented

* §43 defines architecture validation.
* §44 defines cross-section consistency checks.
* §47 defines strict JSON rules.
* §51 defines delivery quality gates.

### Required external verification checks

| ID | Verification control | Required implementation |
|---|---|---|
| V-001 | Skill frontmatter/required-section validity | Skill validator |
| V-002 | JSON parse/schema validity | JSON Schema + validator |
| V-003 | Unique stable IDs/prefixes | `verify.js` or equivalent |
| V-004 | Existing cross-references | `verify.js` or equivalent |
| V-005 | Requirement traceability or blocker | Traceability validator |
| V-006 | Source IDs/locators resolve to PRD | Citation verifier + PRD index |
| V-007 | Markdown/JSON agreement | Cross-artifact comparator |
| V-008 | Mermaid/DOCX diagram agreement | Diagram/render validator |
| V-009 | DOCX structure/accessibility/render quality | Document QA pipeline |
| V-010 | No unapproved technology/schema/unsupported components | Policy/content validator plus reviewer |

### Required test fixtures

| ID | Scenario | Expected observable result |
|---|---|---|
| T-001 | Complete small module PRD | Tier 1 output; complete traceability. |
| T-002 | Standard multi-module PRD | Tier 2 boundaries and workflows. |
| T-003 | Large PRD with migration/integrations | Tier 3, integration/migration coverage. |
| T-004 | Missing critical authentication/boundary | Explicit blocker; no invented provider. |
| T-005 | Contradictory requirements | Both facts preserved; blocker created. |
| T-006 | Explicit technology | Technology preserved as PRD-stated. |
| T-007 | Unspecified technology | Layer remains open. |
| T-008 | Legacy replacement | Current and target state separated. |
| T-009 | Malformed/incomplete source | Safe stop and input-integrity failure. |
| T-010 | Prior defect | Regression remains fixed. |

### Formal negative-case mapping

```text
Open Question
  = unresolved question; represented as Q-xxx and/or [BLOCKED].

Blocked
  = allowed architecture status; impact and minimum action required.

Conflicted
  = test/operational outcome, not a requirement status. Preserve both source
    facts and raise B-xxx rather than silently selecting one.
```

### External capabilities required but not implemented by `SKILL.md`

```text
verify.js or equivalent validation command
architecture.schema.json
test-fixtures/ with source documents and expected evidence
regression-test runner
CI job that publishes verification report
```

### Completion evidence

```text
Versioned verification report with V-001 through V-010 results
Versioned test report with T-001 through T-010 results
Recorded failed/blocked/approved-deviation cases
```

## Phase 5 — Governance and Operations

### Skill behaviour implemented

* Core skill sections require validation, blockers, traceability, decisions,
  and downstream handoff.
* Enterprise Execution Mode requires truthful status language and release
  evidence.

### External capabilities required but not implemented by `SKILL.md`

```text
Git branching and release policy
CI/CD workflow
Execution-metadata logger
Artifact/source hashing
Reviewer approval workflow
Access-control configuration
Metrics dashboard or periodic report
Incident/change-management process for the skill
```

### Minimum execution metadata

```json
{
  "run_id": "",
  "skill_version": "",
  "started_at": "",
  "completed_at": "",
  "source_hashes": [],
  "artifact_hashes": [],
  "validation_status": "",
  "blocker_ids": [],
  "review_status": ""
}
```

### Completion evidence

```text
Named Skill Owner and Release Approver
Versioned release/change record
Run metadata for enterprise executions
Approval record for production release or approved deviation
Metrics/review cadence
```

## Enterprise Readiness Matrix

| Capability | Current `SKILL.md` status | Operational readiness requires |
|---|---|---|
| PRD-first architecture rules | Implemented as instructions | Architecture-run evidence. |
| Tier routing | Specified; core criteria exist | Routing function and fixture results. |
| Context optimisation | Specified | Indexer, hash/path checks, telemetry where available. |
| Verification | Specified | Validators, schema, reports. |
| Regression testing | Specified | Fixtures, runner, CI results. |
| Privacy/audit controls | Specified | Access controls, retention policy, metadata logging. |
| Release management | Specified | Git policy, approvals, CI/CD and rollback procedure. |

## Promotion Rule

Do not label this skill as enterprise-operational until the applicable external
capabilities are `Implemented`, `Executed`, and `Verified` for the release
scope. Before then, label it:

```text
Enterprise-governed skill specification
```

not:

```text
Fully automated enterprise skill
```
