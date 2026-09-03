# Architecture Skill — Release and Branching Policy

**Skill version:** 1.4.0+  
**Owner:** Skill Owner / Architecture Lead  
**Phase:** 5 — Governance and Operations

---

## 1. Branch Policy

| Branch | Purpose | Who may push |
|---|---|---|
| `main` | Production-approved skill versions only | Release Approver only |
| `dev/*` | Development work in progress | Skill contributors |
| `fix/*` | Targeted defect fixes | Skill contributors |

Rules:
- No direct commits to `main`. All changes arrive via pull request.
- Pull requests to `main` require at least one approved review from the Technical Reviewer.
- The CI pipeline must be green before a PR may be merged to `main`.

---

## 2. Release Process

```text
1. Create a development branch (dev/<description>)
        ↓
2. Make changes to SKILL.md, tooling, or fixtures
        ↓
3. Run health-check.js — must be HEALTHY
        ↓
4. Run run-tier-routing-tests.js — all fixtures must pass
        ↓
5. Run run-verification-tests.js — 10/10 must pass
        ↓
6. Update skill-manifest.json — bump version, add changelog entry
        ↓
7. Run changelog-generate.js — regenerate CHANGELOG.md
        ↓
8. Run release-gate.js — all 10 gates must pass
        ↓
9. Open pull request to main
        ↓
10. Technical Reviewer approves PR
        ↓
11. Merge to main
        ↓
12. Create annotated Git tag: git tag -a v<version> -m "<summary>"
        ↓
13. Push tag to origin
        ↓
14. Record approval in governance/baselines/
```

---

## 3. Version Numbering

| Change type | Version increment | Example |
|---|---|---|
| New phase or major capability | Minor version | 1.3.0 → 1.4.0 |
| Bug fix, small addition | Patch version | 1.4.0 → 1.4.1 |
| Breaking change to output contract | Major version | 1.x.x → 2.0.0 |

---

## 4. Named Roles

| Role | Responsibility |
|---|---|
| **Skill Owner** | Owns intent, version, and release readiness. Final authority on scope. |
| **Technical Reviewer** | Reviews architecture quality, skill changes, and PR approval. |
| **Release Approver** | Approves promotion to production use. Signs off release gate report. |
| **Operations Owner** | Monitors failures, metrics, and leads incident response. |

Current assignments: **Sushma S** — Skill Owner / Architecture Lead  
Technical Reviewer and Release Approver: to be assigned before Phase 5 is fully operational.

---

## 5. Rollback Procedure

If a released version produces incorrect architecture output or fails in production:

1. Identify the last known-good Git tag.
2. Open an incident record (see §7).
3. Cherry-pick the rollback or create a `fix/` branch from the last good tag.
4. Run the full release process (steps 3–14 above) against the fix.
5. Do not delete or amend existing release tags — add a new patch version.

---

## 6. Approved Deviations

If a check cannot be run for a valid reason (e.g. LibreOffice unavailable for V-008/V-009):

1. Record the deviation in the release gate report under `approved_deviations`.
2. Include: gate ID, reason, scope, expiry/review date, approver.
3. Do not mark a failed gate as PASS without recording the deviation.

---

## 7. Incident and Change Management

For a defect in a released version:

1. Create a `fix/<description>` branch.
2. Add a T-010-style regression fixture for the defect.
3. Confirm the fixture fails on the defective version (proves the defect).
4. Apply the fix and confirm the fixture passes.
5. Follow the full release process to publish the fix version.
6. Update `skill-manifest.json` changelog with a reference to the defect fixture.

---

## 8. Promotion Rule (from roadmap)

Do not label this skill as enterprise-operational until:

- All applicable Phase 1–5 capabilities are `Implemented`, `Executed`, and `Verified`.
- The release gate (G-001 through G-010) passes in full.
- A named Release Approver has signed off the release gate report.

Until then, the status field in `skill-manifest.json` must remain:

```text
enterprise-governed-specification
```

Current status: **enterprise-governed-specification** (Phase 5 in progress)
