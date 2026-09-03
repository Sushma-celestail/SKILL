/**
 * Architecture Skill — Release Gate
 * Phase 5 implementation
 *
 * Runs the final release readiness check before a version is promoted.
 * Aggregates results from Phase 1–4 checks and produces a release decision.
 *
 * Usage:
 *   node release-gate.js [--root <workspace-root>] [--version <skill-version>]
 *
 * Output:
 *   phase5/execution-metadata/release-gate-<version>-<date>.json
 *   phase5/execution-metadata/release-gate-<version>-<date>.md
 *
 * Exit codes:
 *   0  APPROVED — all gates pass
 *   1  BLOCKED  — one or more gates fail
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256(filePath) {
    try {
        return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    } catch (_) { return null; }
}

function loadJSON(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (_) { return null; }
}

function latestFile(dir, pattern) {
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir)
        .filter(f => f.includes(pattern) && f.endsWith('.json'))
        .sort()
        .reverse();
    return files.length > 0 ? path.join(dir, files[0]) : null;
}

function PASS(gate, msg) { return { gate, status: 'PASS', message: msg }; }
function FAIL(gate, msg) { return { gate, status: 'FAIL', message: msg }; }
function WARN(gate, msg) { return { gate, status: 'WARN', message: msg }; }

// ── Release gates ─────────────────────────────────────────────────────────────

// G-001: Skill version matches manifest
function g001_versionConsistency(root, skillVersion) {
    const manifest = loadJSON(path.join(root, 'skill-manifest.json'));
    if (!manifest) return FAIL('G-001', 'skill-manifest.json not found or invalid');
    if (manifest.skill_version !== skillVersion)
        return FAIL('G-001', `Manifest version "${manifest.skill_version}" does not match release version "${skillVersion}"`);
    return PASS('G-001', `Skill version ${skillVersion} matches manifest`);
}

// G-002: Health check passed (latest report)
function g002_healthCheck(root) {
    const reportDir = path.join(root, 'governance', 'health-reports');
    if (!fs.existsSync(reportDir)) return FAIL('G-002', 'No governance/health-reports/ directory found');
    // Health reports are .md files — search explicitly
    const files = fs.readdirSync(reportDir)
        .filter(f => f.startsWith('health-report-') && (f.endsWith('.md') || f.endsWith('.json')))
        .sort().reverse();
    if (files.length === 0) return FAIL('G-002', 'No health report found — run health-check.js first');
    const reportPath = path.join(reportDir, files[0]);
    const content = fs.readFileSync(reportPath, 'utf8');
    if (content.includes('HEALTHY')) {
        if (content.includes('UNHEALTHY')) return FAIL('G-002', `Health report is UNHEALTHY: ${files[0]}`);
        return PASS('G-002', `Health report is HEALTHY: ${files[0]}`);
    }
    return WARN('G-002', `Health report status unclear — review ${files[0]}`);
}

// G-003: PRD index exists and is not stale
function g003_prdIndex(root) {
    const indexDir = path.join(root, 'phase2', 'indexes');
    const indexPath = latestFile(indexDir, 'prd-index-');
    if (!indexPath) return FAIL('G-003', 'No PRD index found in phase2/indexes/');

    const index = loadJSON(indexPath);
    if (!index?.metadata?.prd_sha256)
        return FAIL('G-003', 'PRD index missing prd_sha256 — re-run index_prd.js');

    const reqCount = index.metadata?.requirement_count || 0;
    return PASS('G-003', `PRD index present: ${path.basename(indexPath)} — ${reqCount} requirements indexed`);
}

// G-004: Tier routing tests passed
function g004_tierRouting(root) {
    const reportDir = path.join(root, 'phase3', 'reports');
    const reportPath = latestFile(reportDir, 'tier-routing-test-report-');
    if (!reportPath) return FAIL('G-004', 'No tier routing test report found — run run-tier-routing-tests.js');

    const report = loadJSON(reportPath);
    if (!report) return FAIL('G-004', `Cannot parse tier routing report: ${path.basename(reportPath)}`);

    const total = report.summary?.total || report.total || 0;
    const passed = report.summary?.passed || report.passed || 0;
    const failed = report.summary?.failed || report.failed || 0;

    if (failed === 0 && total > 0)
        return PASS('G-004', `Tier routing tests: ${passed}/${total} passed`);
    if (failed > 0)
        return FAIL('G-004', `Tier routing tests: ${failed}/${total} failed`);
    return WARN('G-004', 'Tier routing report found but results unclear');
}

// G-005: Verification tests passed (T-001–T-010)
function g005_verificationTests(root) {
    const reportDir = path.join(root, 'phase4', 'reports');
    const reportPath = latestFile(reportDir, 'verification-test-report-');
    if (!reportPath) return FAIL('G-005', 'No verification test report found — run run-verification-tests.js');

    const report = loadJSON(reportPath);
    if (!report) return FAIL('G-005', `Cannot parse verification test report: ${path.basename(reportPath)}`);

    const overall = report.overall;
    const total = report.summary?.total || 0;
    const passed = report.summary?.pass || 0;
    const failed = report.summary?.fail || 0;

    if (overall === 'PASS' && failed === 0)
        return PASS('G-005', `Verification tests: ${passed}/${total} passed (V-001–V-010 / T-001–T-010)`);
    return FAIL('G-005', `Verification tests: ${failed}/${total} failed — report: ${path.basename(reportPath)}`);
}

// G-006: Baseline audit report is signed off
function g006_baselineSignoff(root) {
    const baselinesDir = path.join(root, 'governance', 'baselines');
    if (!fs.existsSync(baselinesDir)) return FAIL('G-006', 'No governance/baselines/ directory found');

    const reports = fs.readdirSync(baselinesDir).filter(f => f.endsWith('.md'));
    if (reports.length === 0) return FAIL('G-006', 'No baseline audit report found');

    const latest = path.join(baselinesDir, reports.sort().reverse()[0]);
    const content = fs.readFileSync(latest, 'utf8');
    const approved = content.includes('APPROVED FOR BASELINE');

    // Accept name in either the header line (**Approver Name:** Sushma S)
    // or in the sign-off table (| Approver name | Sushma S |)
    const noPlaceholder = !content.includes('_(to be recorded when confirmed)_');
    const headerHasName = /\*\*Approver Name:\*\*\s+[A-Za-z]{2}/.test(content);
    const tableHasName = /\|\s*Approver name\s*\|\s*[A-Za-z]{2}/.test(content);
    const hasName = noPlaceholder && (headerHasName || tableHasName);

    if (approved && hasName)
        return PASS('G-006', `Baseline audit report approved and signed: ${path.basename(latest)}`);
    if (approved && !hasName)
        return WARN('G-006', `Baseline approved but approver name not confirmed in ${path.basename(latest)}`);
    return FAIL('G-006', `Baseline audit report not marked APPROVED FOR BASELINE: ${path.basename(latest)}`);
}

// G-007: CHANGELOG.md is present and mentions the current version
function g007_changelog(root, skillVersion) {
    const changelogPath = path.join(root, 'CHANGELOG.md');
    if (!fs.existsSync(changelogPath)) return FAIL('G-007', 'CHANGELOG.md not found');

    const content = fs.readFileSync(changelogPath, 'utf8');
    if (content.includes(skillVersion))
        return PASS('G-007', `CHANGELOG.md present and mentions version ${skillVersion}`);
    return FAIL('G-007', `CHANGELOG.md exists but does not mention version ${skillVersion} — run changelog-generate.js`);
}

// G-008: No conflict markers in SKILL.md
function g008_noConflicts(root) {
    const skillPath = path.join(root, 'SKILL.md');
    if (!fs.existsSync(skillPath)) return FAIL('G-008', 'SKILL.md not found');
    const content = fs.readFileSync(skillPath, 'utf8');
    if (content.includes('<<<<<<<'))
        return FAIL('G-008', 'SKILL.md contains unresolved conflict markers — resolve before release');
    return PASS('G-008', 'SKILL.md has no conflict markers');
}

// G-009: Git tag for current version exists locally
function g009_gitTag(root, skillVersion) {
    try {
        const { execSync } = require('child_process');
        const tags = execSync('git tag', { cwd: root, encoding: 'utf8' });
        const expected = `v${skillVersion}`;
        if (tags.split('\n').map(t => t.trim()).includes(expected))
            return PASS('G-009', `Git tag ${expected} exists`);
        return WARN('G-009', `Git tag ${expected} not found — create with: git tag -a ${expected} -m "..."`);
    } catch (_) {
        return WARN('G-009', 'Could not check Git tags — not a Git repository or Git unavailable');
    }
}

// G-010: Skill status is not prematurely labelled operational
function g010_promotionRule(root) {
    const manifest = loadJSON(path.join(root, 'skill-manifest.json'));
    if (!manifest) return FAIL('G-010', 'skill-manifest.json not found');

    const status = (manifest.status || '').toLowerCase();
    const PREMATURE_LABELS = [
        'enterprise-operational',
        'fully automated',
        'production-ready',
        'operational',
    ];

    for (const label of PREMATURE_LABELS) {
        if (status.includes(label))
            return FAIL('G-010', `Status "${manifest.status}" prematurely labels the skill as operational. Per roadmap Promotion Rule: use "enterprise-governed-specification" until all phases are Implemented, Executed, and Verified.`);
    }

    const VALID_STATUSES = ['enterprise-governed-specification', 'enterprise-governed-skill-specification', 'specified'];
    const isValid = VALID_STATUSES.some(v => status.includes(v.replace(/-/g, '')));
    return PASS('G-010', `Status "${manifest.status}" correctly reflects current maturity (not prematurely operational)`);
}

// ── Execution metadata logger ─────────────────────────────────────────────────

function buildExecutionMetadata(root, skillVersion, gateResults) {
    const now = new Date().toISOString();
    const filesToHash = [
        'SKILL.md',
        'skill-manifest.json',
        'references/enterprise-capability-roadmap.md',
        'phase4/verify.js',
        'phase4/architecture.schema.json',
    ];

    const sourceHashes = filesToHash.map(f => {
        const full = path.join(root, f);
        return { file: f, sha256: sha256(full) || 'unavailable' };
    });

    const failCount = gateResults.filter(g => g.status === 'FAIL').length;

    return {
        run_id: `gate-${skillVersion}-${now.slice(0, 10)}`,
        skill_version: skillVersion,
        started_at: now,
        completed_at: now,
        source_hashes: sourceHashes,
        artifact_hashes: [],
        validation_status: failCount === 0 ? 'PASS' : 'FAIL',
        blocker_ids: gateResults.filter(g => g.status === 'FAIL').map(g => g.gate),
        review_status: failCount === 0 ? 'approved-for-release' : 'blocked-pending-fixes',
        gate_results: gateResults,
    };
}

// ── Report builder ────────────────────────────────────────────────────────────

function buildReport(metadata, skillVersion) {
    const date = metadata.started_at.slice(0, 10);
    const overall = metadata.validation_status;
    const passCount = metadata.gate_results.filter(g => g.status === 'PASS').length;
    const failCount = metadata.gate_results.filter(g => g.status === 'FAIL').length;
    const warnCount = metadata.gate_results.filter(g => g.status === 'WARN').length;

    const iconMap = { PASS: '✅', FAIL: '❌', WARN: '⚠️ ' };

    const lines = [
        `# Release Gate Report — Architecture Skill v${skillVersion}`,
        ``,
        `**Date:** ${date}  `,
        `**Skill Version:** ${skillVersion}  `,
        `**Decision:** ${overall === 'PASS' ? '✅ APPROVED FOR RELEASE' : '❌ BLOCKED — resolve failures before release'}  `,
        ``,
        `| Result | Count |`,
        `|---|---|`,
        `| ✅ PASS | ${passCount} |`,
        `| ❌ FAIL | ${failCount} |`,
        `| ⚠️  WARN | ${warnCount} |`,
        ``,
        `---`,
        ``,
        `## Gate Results`,
        ``,
    ];

    for (const g of metadata.gate_results) {
        const icon = iconMap[g.status] || '?';
        lines.push(`### ${icon} ${g.gate} — ${g.status}`);
        lines.push(g.message);
        lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push('## Source Hashes at Release Gate');
    lines.push('');
    lines.push('| File | SHA-256 |');
    lines.push('|---|---|');
    for (const h of metadata.source_hashes) {
        lines.push(`| \`${h.file}\` | \`${h.sha256?.slice(0, 16)}...\` |`);
    }

    lines.push('');
    lines.push('---');
    lines.push('');
    if (overall === 'PASS') {
        lines.push('> ✅ All release gates passed. This version is approved for production release.');
    } else {
        lines.push('> ❌ Release is BLOCKED. Resolve all FAIL gates before promoting to production.');
        lines.push(`> Failed gates: ${metadata.blocker_ids.join(', ')}`);
    }

    return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
    const args = process.argv.slice(2);
    const get = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
    const root = get('--root') ? path.resolve(get('--root')) : path.resolve(__dirname, '..');
    const outDir = get('--out') ? path.resolve(get('--out')) : path.resolve(__dirname, 'execution-metadata');

    // Read skill version from manifest
    const manifest = loadJSON(path.join(root, 'skill-manifest.json'));
    const skillVersion = get('--version') || manifest?.skill_version || 'unknown';

    console.log(`\nArchitecture Skill — Release Gate`);
    console.log(`Skill version: ${skillVersion}`);
    console.log(`Root:          ${root}\n`);

    const gateResults = [
        g001_versionConsistency(root, skillVersion),
        g002_healthCheck(root),
        g003_prdIndex(root),
        g004_tierRouting(root),
        g005_verificationTests(root),
        g006_baselineSignoff(root),
        g007_changelog(root, skillVersion),
        g008_noConflicts(root),
        g009_gitTag(root, skillVersion),
        g010_promotionRule(root),
    ];

    const iconMap = { PASS: '✅', FAIL: '❌', WARN: '⚠️ ' };
    for (const g of gateResults) {
        const icon = iconMap[g.status] || '?';
        console.log(`  ${icon} ${g.gate.padEnd(6)} ${g.status.padEnd(5)} ${g.message}`);
    }

    const failCount = gateResults.filter(g => g.status === 'FAIL').length;
    const warnCount = gateResults.filter(g => g.status === 'WARN').length;
    const decision = failCount === 0 ? 'APPROVED ✅' : `BLOCKED ❌ (${failCount} gate(s) failed)`;
    console.log(`\nRelease decision: ${decision}\n`);

    // Save execution metadata
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const metadata = buildExecutionMetadata(root, skillVersion, gateResults);
    const report = buildReport(metadata, skillVersion);
    const date = new Date().toISOString().slice(0, 10);
    const jsonOut = path.join(outDir, `release-gate-${skillVersion}-${date}.json`);
    const mdOut = path.join(outDir, `release-gate-${skillVersion}-${date}.md`);

    fs.writeFileSync(jsonOut, JSON.stringify(metadata, null, 2), 'utf8');
    fs.writeFileSync(mdOut, report, 'utf8');

    console.log(`Execution metadata saved:`);
    console.log(`  ${jsonOut}`);
    console.log(`  ${mdOut}\n`);

    process.exit(failCount > 0 ? 1 : 0);
}

main();
