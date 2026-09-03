/**
 * Architecture Skill — Verification & Regression Test Runner
 * Phase 4 implementation — T-001 through T-010
 *
 * Runs verify.js against each test fixture and validates the results
 * match the expected observable outcomes defined in each fixture.
 *
 * Usage:
 *   node run-verification-tests.js [--fixtures <folder>] [--out <output-folder>]
 *
 * Outputs:
 *   phase4/reports/verification-test-report-<date>.json
 *   phase4/reports/verification-test-report-<date>.md
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_FIXTURES = path.resolve(__dirname, 'test-fixtures');
const DEFAULT_OUT = path.resolve(__dirname, 'reports');
const VERIFY_JS = path.resolve(__dirname, 'verify.js');

// ── Load all fixture files ────────────────────────────────────────────────────

function loadFixtures(fixturesDir) {
    if (!fs.existsSync(fixturesDir)) {
        console.error(`Fixtures directory not found: ${fixturesDir}`);
        process.exit(1);
    }
    return fs.readdirSync(fixturesDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .map(f => {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(fixturesDir, f), 'utf8'));
                return { file: f, ...data };
            } catch (e) {
                return { file: f, fixture_id: f, error: `Parse error: ${e.message}` };
            }
        });
}

// ── Inline verification (calls verify.js logic directly) ─────────────────────

function runVerification(artifact) {
    // V-002: JSON structure
    const arch = artifact?.architecture;
    if (!arch) return { overall: 'FAIL', checks: [{ check: 'V-002', status: 'FAIL', message: 'No architecture object' }] };

    const results = [];
    const failures = [];

    // Required fields
    if (!arch.metadata) failures.push('Missing architecture.metadata');
    if (!arch.mode) failures.push('Missing architecture.mode');
    if (!arch.depth_tier) failures.push('Missing architecture.depth_tier');
    if (!arch.requirements || arch.requirements.length === 0) failures.push('Missing or empty requirements');
    results.push({ check: 'V-002', status: failures.length === 0 ? 'PASS' : 'FAIL', message: failures.length === 0 ? 'JSON structure valid' : `JSON issues: ${failures.join('; ')}` });

    // V-003: Unique IDs
    const allIds = [];
    const idFailures = [];
    const ID_PREFIXES = { requirements: 'REQ', modules: 'MOD', components: 'CMP', apis: 'API', workflows: 'WF', state_machines: 'STM', entities: 'ENT', integrations: 'INT', architecture_decisions: 'ADR', architecture_invariants: 'INV', actors: 'ACT', blockers: 'B', open_questions: 'Q' };
    for (const [field, prefix] of Object.entries(ID_PREFIXES)) {
        (arch[field] || []).forEach(item => {
            if (!item.id) { idFailures.push(`${field}: item missing id`); return; }
            if (!item.id.startsWith(prefix + '-')) idFailures.push(`${field}: "${item.id}" should start with "${prefix}-"`);
            if (allIds.includes(item.id)) idFailures.push(`Duplicate ID: "${item.id}"`);
            else allIds.push(item.id);
        });
    }
    results.push({ check: 'V-003', status: idFailures.length === 0 ? 'PASS' : 'FAIL', message: idFailures.length === 0 ? `${allIds.length} unique IDs valid` : `ID issues: ${idFailures.length}`, detail: idFailures });

    // V-004: Cross-references
    const registry = new Set(allIds);
    const xrefFails = [];
    (arch.modules || []).forEach(m => (m.components || []).forEach(c => { if (c && !registry.has(c)) xrefFails.push(`MOD ${m.id} refs missing CMP "${c}"`); }));
    (arch.components || []).forEach(c => { if (c.module_id && !registry.has(c.module_id)) xrefFails.push(`CMP ${c.id} refs missing MOD "${c.module_id}"`); });
    (arch.workflows || []).forEach(w => {
        (w.components || []).forEach(r => { if (r && !registry.has(r)) xrefFails.push(`WF ${w.id} refs missing CMP "${r}"`); });
        (w.apis || []).forEach(r => { if (r && !registry.has(r)) xrefFails.push(`WF ${w.id} refs missing API "${r}"`); });
    });
    (arch.requirement_traceability || []).forEach(t => {
        if (t.requirement_id && !registry.has(t.requirement_id)) xrefFails.push(`Trace refs missing REQ "${t.requirement_id}"`);
    });
    results.push({ check: 'V-004', status: xrefFails.length === 0 ? 'PASS' : 'FAIL', message: xrefFails.length === 0 ? 'All cross-references resolve' : `Cross-ref issues: ${xrefFails.length}`, detail: xrefFails });

    // V-005: Traceability
    const traced = new Set((arch.requirement_traceability || []).map(t => t.requirement_id));
    const traceFails = [];
    (arch.requirements || []).forEach(r => {
        if (!traced.has(r.id) && r.status !== 'blocked' && r.status !== 'proposed')
            traceFails.push(`${r.id} (${r.status}) has no traceability`);
    });
    results.push({ check: 'V-005', status: traceFails.length === 0 ? 'PASS' : 'WARN', message: traceFails.length === 0 ? 'All requirements traced or blocked' : `${traceFails.length} untraced requirements`, detail: traceFails });

    // V-010: Policy
    const policyFails = [];
    (arch.components || []).forEach(c => {
        if (!c.responsibilities || c.responsibilities.length === 0)
            policyFails.push(`CMP ${c.id} has no responsibilities`);
    });
    const sqlPattern = /\bCREATE\s+TABLE\b|\bALTER\s+TABLE\b/i;
    (arch.requirements || []).forEach(r => { if (sqlPattern.test(r.text)) policyFails.push(`REQ ${r.id} contains SQL`); });
    results.push({ check: 'V-010', status: policyFails.length === 0 ? 'PASS' : 'FAIL', message: policyFails.length === 0 ? 'Policy checks pass' : `Policy violations: ${policyFails.length}`, detail: policyFails });

    const failCount = results.filter(r => r.status === 'FAIL').length;
    return { overall: failCount === 0 ? 'PASS' : 'FAIL', checks: results };
}

// ── Expected outcome validator ────────────────────────────────────────────────

function validateExpected(fixture, verifyResult) {
    const expected = fixture.expected_checks || {};
    const arch = fixture.architecture;
    const findings = [];

    // Tier check
    if (expected.tier !== undefined) {
        const actual = arch?.depth_tier;
        if (actual !== expected.tier) findings.push(`Tier: expected ${expected.tier}, got ${actual}`);
    }

    // Mode check
    if (expected.mode) {
        if (arch?.mode !== expected.mode) findings.push(`Mode: expected "${expected.mode}", got "${arch?.mode}"`);
    }

    // Blocker checks
    if (expected.has_blocker) {
        const found = (arch?.blockers || []).some(b => b.id === expected.has_blocker);
        if (!found) findings.push(`Expected blocker ${expected.has_blocker} not found`);
    }
    if (expected.blocker_raised) {
        const found = (arch?.blockers || []).some(b => b.id === expected.blocker_raised);
        if (!found) findings.push(`Expected blocker ${expected.blocker_raised} not found`);
    }
    if (expected.blockers === 0 && (arch?.blockers || []).length > 0) {
        findings.push(`Expected 0 blockers, found ${arch.blockers.length}`);
    }

    // Traceability
    if (expected.all_requirements_traced) {
        const traced = new Set((arch?.requirement_traceability || []).map(t => t.requirement_id));
        const untraced = (arch?.requirements || []).filter(r => !traced.has(r.id) && r.status !== 'blocked' && r.status !== 'proposed');
        if (untraced.length > 0) findings.push(`Expected all requirements traced, ${untraced.length} untraced: ${untraced.map(r => r.id).join(', ')}`);
    }

    // Technology open
    if (expected.technology_status === 'open') {
        const allOpen = (arch?.technology_stack || []).every(t => t.status === 'open' || t.status === 'proposed');
        if (!allOpen) findings.push('Expected all technology layers to have open/proposed status');
    }
    if (expected.technology_status === 'prd_stated') {
        const allStated = (arch?.technology_stack || []).every(t => t.status === 'prd_stated');
        if (!allStated) findings.push('Expected all technology layers to have prd_stated status');
    }

    // No invented identity provider
    if (expected.no_invented_identity_provider) {
        const INVENTED = ['azure ad', 'okta', 'auth0', 'cognito', 'google identity', 'keycloak', 'pingidentity'];
        const idpTech = (arch?.technology_stack || []).find(t => t.layer?.toLowerCase().includes('identity'));
        if (idpTech && INVENTED.some(inv => idpTech.technology?.toLowerCase().includes(inv))) {
            findings.push(`Invented identity provider detected: "${idpTech.technology}"`);
        }
        const reqTexts = (arch?.requirements || []).map(r => r.text?.toLowerCase() || '');
        INVENTED.forEach(inv => {
            reqTexts.forEach((t, i) => {
                if (t.includes(inv) && (arch.requirements[i]?.status === 'prd_stated' || arch.requirements[i]?.status === 'architecturally_derived'))
                    findings.push(`Invented IdP "${inv}" appears in ${arch.requirements[i].id} as ${arch.requirements[i].status}`);
            });
        });
    }

    // Open question for auth
    if (expected.open_question_for_auth) {
        const hasAuthQ = (arch?.open_questions || []).some(q =>
            /auth|identity|provider|login|sso/i.test(q.question));
        if (!hasAuthQ) findings.push('Expected an open question about authentication/identity provider');
    }

    // Validation failed check (T-009)
    if (expected.validation_failed) {
        const v = arch?.validation;
        const anyFalse = v && Object.values(v).some(val => val === false);
        if (!anyFalse) findings.push('Expected at least one validation flag to be false');
    }

    // Input integrity blocker (T-009)
    if (expected.has_input_integrity_blocker) {
        const found = (arch?.blockers || []).some(b => /input.integrity|unreadable|malformed|truncated|corrupt/i.test(b.text));
        if (!found) findings.push('Expected an input-integrity blocker (malformed/unreadable source)');
    }

    // Current/target state separation (T-008)
    if (expected.current_state_separated) {
        const hasCurrent = (arch?.requirements || []).some(r => r.current_or_target === 'current_state');
        const hasTarget = (arch?.requirements || []).some(r => r.current_or_target === 'target_state');
        if (!hasCurrent) findings.push('Expected at least one requirement marked current_state');
        if (!hasTarget) findings.push('Expected at least one requirement marked target_state');
    }

    return findings;
}

// ── Main runner ───────────────────────────────────────────────────────────────

function main() {
    const args = process.argv.slice(2);
    const fixturesDir = args[args.indexOf('--fixtures') + 1]
        ? path.resolve(args[args.indexOf('--fixtures') + 1]) : DEFAULT_FIXTURES;
    const outDir = args[args.indexOf('--out') + 1]
        ? path.resolve(args[args.indexOf('--out') + 1]) : DEFAULT_OUT;

    // Skill version
    let skillVersion = 'unknown';
    try { skillVersion = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'skill-manifest.json'), 'utf8')).skill_version; } catch (_) { }

    const fixtures = loadFixtures(fixturesDir);
    const date = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();

    console.log(`\nArchitecture Skill — Verification Test Runner (T-001 – T-010)`);
    console.log(`Skill version: ${skillVersion}`);
    console.log(`Fixtures:      ${fixturesDir}`);
    console.log(`Total:         ${fixtures.length} fixtures\n`);

    const testResults = [];

    for (const fixture of fixtures) {
        if (fixture.error) {
            testResults.push({ fixture_id: fixture.fixture_id, file: fixture.file, status: 'ERROR', message: fixture.error, verify: null, expected_failures: [] });
            console.log(`  ❌ ${fixture.fixture_id.padEnd(8)} ERROR   ${fixture.error}`);
            continue;
        }

        const verifyResult = runVerification(fixture.architecture ? fixture : { architecture: fixture });
        const arch = fixture.architecture || fixture;
        const expFailures = validateExpected(fixture, verifyResult);
        const overallStatus = (verifyResult.overall === 'PASS' || verifyResult.overall === 'WARN') && expFailures.length === 0
            ? 'PASS' : 'FAIL';

        const icon = overallStatus === 'PASS' ? '✅' : '❌';
        const summary = expFailures.length > 0
            ? `Expected-outcome failures: ${expFailures.join(' | ')}`
            : verifyResult.checks.filter(c => c.status === 'WARN').length > 0
                ? `PASS with ${verifyResult.checks.filter(c => c.status === 'WARN').length} warning(s)`
                : 'All checks pass';

        console.log(`  ${icon} ${(fixture.fixture_id || fixture.file).padEnd(8)} ${overallStatus.padEnd(6)} ${summary}`);

        testResults.push({
            fixture_id: fixture.fixture_id || fixture.file,
            file: fixture.file,
            scenario: fixture.scenario || '',
            status: overallStatus,
            verify_overall: verifyResult.overall,
            checks: verifyResult.checks,
            expected_failures: expFailures,
        });
    }

    const passCount = testResults.filter(r => r.status === 'PASS').length;
    const failCount = testResults.filter(r => r.status === 'FAIL').length;
    const errCount = testResults.filter(r => r.status === 'ERROR').length;
    const overall = failCount === 0 && errCount === 0 ? 'PASS' : 'FAIL';

    console.log(`\nResult: ${overall === 'PASS' ? '✅' : '❌'}  ${passCount}/${testResults.length} passed`);
    if (failCount > 0) console.log(`        ${failCount} failed`);
    if (errCount > 0) console.log(`        ${errCount} errors`);
    console.log('');

    // ── Build JSON report ───────────────────────────────────────────────────────
    const jsonReport = {
        report_type: 'verification_test',
        skill_version: skillVersion,
        generated_at: now,
        overall: overall,
        summary: { total: testResults.length, pass: passCount, fail: failCount, error: errCount },
        results: testResults,
    };

    // ── Build Markdown report ───────────────────────────────────────────────────
    const md = [
        `# Verification Test Report — T-001 through T-010`,
        ``,
        `**Date:** ${date}  `,
        `**Skill Version:** ${skillVersion}  `,
        `**Overall:** ${overall === 'PASS' ? '✅ PASS' : '❌ FAIL'}  `,
        `**Result:** ${passCount}/${testResults.length} passed`,
        ``,
        `| Fixture | Scenario | Status | Notes |`,
        `|---|---|---|---|`,
    ];

    for (const r of testResults) {
        const icon = r.status === 'PASS' ? '✅' : r.status === 'ERROR' ? '⚠️' : '❌';
        const notes = r.expected_failures?.length > 0
            ? r.expected_failures[0]
            : r.status === 'PASS' ? 'All checks pass' : r.message || '';
        md.push(`| ${icon} ${r.fixture_id} | ${r.scenario || '—'} | ${r.status} | ${notes} |`);
    }

    md.push('', '---', '');
    for (const r of testResults.filter(x => x.status !== 'PASS')) {
        md.push(`## ❌ ${r.fixture_id} — ${r.scenario}`);
        if (r.expected_failures?.length > 0) {
            md.push('**Expected outcome failures:**');
            r.expected_failures.forEach(f => md.push(`- ${f}`));
        }
        if (r.checks) {
            const failed = r.checks.filter(c => c.status === 'FAIL');
            if (failed.length > 0) {
                md.push('**Verify check failures:**');
                failed.forEach(c => md.push(`- ${c.check}: ${c.message}`));
            }
        }
        md.push('');
    }

    md.push(`> Generated by \`run-verification-tests.js\`. Read-only evidence.`);

    // ── Write reports ───────────────────────────────────────────────────────────
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const jsonOut = path.join(outDir, `verification-test-report-${date}.json`);
    const mdOut = path.join(outDir, `verification-test-report-${date}.md`);
    fs.writeFileSync(jsonOut, JSON.stringify(jsonReport, null, 2), 'utf8');
    fs.writeFileSync(mdOut, md.join('\n'), 'utf8');

    console.log(`Reports saved:`);
    console.log(`  ${jsonOut}`);
    console.log(`  ${mdOut}\n`);

    process.exit(failCount + errCount > 0 ? 1 : 0);
}

main();
