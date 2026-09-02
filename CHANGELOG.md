# Changelog — architecture-skill

All notable changes to this skill are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

> **Version source:** `skill-manifest.json`  
> Git tags are the recommended future mechanism once a repository is initialised.

---

## [1.2.0] — 2026-09-02

**Summary:** Phase 2: Added Source Index Contract to §60 (formal JSON schema for requirement inventory + source hash record + integrity rules + tooling reference). Implemented phase2/index_prd.js (PRD indexer + source hash generator, 601 requirements extracted from Service Desk PRD) and phase2/stale-source-detect.js (stale source / hash mismatch detector). Closes GAP-009.

**Compatibility impact:** Additive. §60 gains the Source Index Contract subsection and tooling reference. No existing sections removed or renamed.

**Approver:** Skill Owner / Architecture Lead

---

## [1.1.0] — 2026-09-02

**Summary:** Added enterprise operating model (§57–§67), deterministic tier routing (§59), automated verification rules (§62), test/regression suite categories (§63), failure recovery (§64), human review and approval rules (§65), monitoring and metrics (§66), enterprise release checklist (§67), and Phase 1 baseline establishment (§68).

**Compatibility impact:** Additive. No existing architecture output fields were removed or renamed.

**Approver:** Skill Owner / Architecture Lead

---

## [1.0.0] — 2026-08-31

**Summary:** Initial enterprise skill specification. Core PRD-to-architecture design, traceability, validation, and downstream handoff.

**Compatibility impact:** N/A — initial release.

**Approver:** Skill Owner / Architecture Lead

---
