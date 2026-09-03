/**
 * Architecture Skill — Repository Health Checker
 * Phase 1 implementation (GAP-003)
 *
 * Checks:
 *   1. Required files exist
 *   2. skill-manifest.json is valid JSON and has required fields
 *   3. SKILL.md frontmatter is present and parseable
 *   4. Files referenced in skill-manifest.json resolve to real paths
 *   5. SKILL.md has no unfinished/conflict markers
 *   6. Expected enterprise sections (§57–§68) are present in SKILL.md
 *   7. SHA-256 hashes are recorded for all required files
 *
 * Usage:
 *   node health-check.js [--root <path>]
 *
 * Output:
 *   Console summary + governance/health-reports/health-report-<date>.md
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_ROOT = path.resolve(__dirname, '..');

const REQUIRED_FILES = [
    'SKILL.md',
    'skill-manifest.json',
    'references/enterprise-capability-roadmap.md',
    'phase3/tier-routing.js',
    'phase3/run-tier-routing-tests.js',
    'phase4/verify.js',
    'phase4/architecture.schema.json',
    'phase4/run-verification-tests.js',
    'phase5/release-gate.js',
    'phase5/execution-metadata-logger.js',
    'phase5/metrics-report.js',
    'phase5/RELEASE-POLICY.md',
];

// Files that are expected once the full package is assembled
// (warned if missing, not failed — they may live in a separate Codex folder)
const OPTIONAL_FILES = [];

const REQUIRED_MANIFEST_FIELDS = [
    'skill_name',
    'skill_version',
    'release_date',
    'status',
    'canonical_file',
    'changelog',
];

const CONFLICT_MARKERS = ['<<<<<<<', '=======', '>>>>>>>'];

const EXPECTED_SECTIONS = [
    '## 57. ENTERPRISE OPERATING MODEL',
    '## 58. INPUT INTEGRITY, ACCESS, AND PRIVACY',
    '## 59. DETERMINISTIC ROUTING AND DEPTH SELECTION',
    '## 60. CONTEXT AND TOKEN EFFICIENCY',
    '## 61. EXECUTION METADATA AND AUDIT TRAIL',
    '## 62. AUTOMATED VERIFICATION',
    '## 63. TEST, NEGATIVE-CASE, AND REGRESSION SUITE',
    '## 64. FAILURE HANDLING AND RECOVERY',
    '## 65. HUMAN REVIEW, APPROVAL, AND DECISION PROMOTION',
    '## 66. MONITORING, METRICS, AND SERVICE OWNERSHIP',
    '## 67. ENTERPRISE RELEASE CHECKLIST',
    '## 68. PHASE 1',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(filePath) {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
}

function pass(msg) { return { status: 'PASS', message: msg }; }
function fail(msg) { return { status: 'FAIL', message: msg }; }
function warn(msg) { return { status: 'WARN', message: msg }; }

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function checkRequiredFiles(root) {
    const results = [];
    for (const rel of REQUIRED_FILES) {
        const full = path.join(root, rel);
        if (fs.existsSync(full)) {
            results.push(pass(`Required file exists: ${rel}`));
        } else {
            results.push(fail(`Required file MISSING: ${rel}`));
        }
    }
    for (const rel of OPTIONAL_FILES) {
        const full = path.join(root, rel);
        if (fs.existsSync(full)) {
            results.push(pass(`Optional file exists: ${rel}`));
        } else {
            results.push(warn(`Optional file not present (expected in full package): ${rel}`));
        }
    }
    return results;
}

function checkManifest(root) {
    const results = [];
    const manifestPath = path.join(root, 'skill-manifest.json');

    if (!fs.existsSync(manifestPath)) {
        return [fail('skill-manifest.json not found — skipping manifest checks')];
    }

    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        results.push(pass('skill-manifest.json is valid JSON'));
    } catch (e) {
        return [fail(`skill-manifest.json is not valid JSON: ${e.message}`)];
    }

    for (const field of REQUIRED_MANIFEST_FIELDS) {
        if (manifest[field] !== undefined) {
            results.push(pass(`Manifest field present: ${field}`));
        } else {
            results.push(fail(`Manifest field MISSING: ${field}`));
        }
    }

    // Check referenced files resolve
    if (Array.isArray(manifest.references)) {
        for (const ref of manifest.references) {
            const refPath = path.join(root, ref);
            if (fs.existsSync(refPath)) {
                results.push(pass(`Referenced file resolves: ${ref}`));
            } else {
                results.push(fail(`Referenced file MISSING (listed in manifest): ${ref}`));
            }
        }
    }

    return results;
}

function checkConflictMarkers(root) {
    const results = [];
    const skillPath = path.join(root, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
        return [fail('SKILL.md not found — skipping conflict marker check')];
    }

    const content = fs.readFileSync(skillPath, 'utf8');
    const lines = content.split('\n');
    const found = [];

    lines.forEach((line, idx) => {
        for (const marker of CONFLICT_MARKERS) {
            if (line.startsWith(marker)) {
                found.push(`Line ${idx + 1}: ${line.trim()}`);
            }
        }
    });

    if (found.length === 0) {
        results.push(pass('SKILL.md has no unresolved conflict markers'));
    } else {
        for (const f of found) {
            results.push(fail(`Conflict marker found in SKILL.md — ${f}`));
        }
    }

    return results;
}

function checkExpectedSections(root) {
    const results = [];
    const skillPath = path.join(root, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
        return [fail('SKILL.md not found — skipping section checks')];
    }

    const content = fs.readFileSync(skillPath, 'utf8');

    for (const section of EXPECTED_SECTIONS) {
        if (content.includes(section)) {
            results.push(pass(`Enterprise section present: "${section}"`));
        } else {
            results.push(fail(`Enterprise section MISSING: "${section}"`));
        }
    }

    return results;
}

function checkFrontmatter(root) {
    const results = [];
    const skillPath = path.join(root, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
        return [fail('SKILL.md not found — skipping frontmatter check')];
    }

    const content = fs.readFileSync(skillPath, 'utf8');
    if (content.startsWith('---')) {
        const end = content.indexOf('---', 3);
        if (end > 3) {
            results.push(pass('SKILL.md frontmatter block is present'));
        } else {
            results.push(fail('SKILL.md frontmatter block is not closed'));
        }
    } else {
        results.push(warn('SKILL.md has no frontmatter block (--- delimited)'));
    }

    return results;
}

function recordHashes(root) {
    const results = [];
    const hashes = {};
    const allFiles = [...REQUIRED_FILES, ...OPTIONAL_FILES];

    for (const rel of allFiles) {
        const full = path.join(root, rel);
        if (fs.existsSync(full)) {
            const hash = sha256(full);
            hashes[rel] = hash;
            results.push(pass(`SHA-256 recorded: ${rel} → ${hash.slice(0, 16)}...`));
        } else {
            results.push(warn(`Cannot hash — file not present: ${rel}`));
        }
    }

    return { results, hashes };
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function generateReport(allResults, hashes, root, version) {
    const date = new Date().toISOString().slice(0, 10);
    const passCount = allResults.filter(r => r.status === 'PASS').length;
    const failCount = allResults.filter(r => r.status === 'FAIL').length;
    const warnCount = allResults.filter(r => r.status === 'WARN').length;
    const overall = failCount === 0 ? 'HEALTHY' : 'UNHEALTHY';

    const lines = [
        `# Repository Health Report`,
        ``,
        `**Date:** ${date}  `,
        `**Skill Version:** ${version}  `,
        `**Root Path:** ${root}  `,
        `**Overall Status:** ${overall}  `,
        ``,
        `| Result | Count |`,
        `|---|---|`,
        `| ✅ PASS | ${passCount} |`,
        `| ❌ FAIL | ${failCount} |`,
        `| ⚠️  WARN | ${warnCount} |`,
        ``,
        `---`,
        ``,
        `## Check Results`,
        ``,
    ];

    for (const r of allResults) {
        const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⚠️ ';
        lines.push(`- ${icon} **${r.status}** — ${r.message}`);
    }

    lines.push('', '---', '', '## File Hashes (SHA-256)', '');
    lines.push('| File | SHA-256 |');
    lines.push('|---|---|');
    for (const [rel, hash] of Object.entries(hashes)) {
        lines.push(`| \`${rel}\` | \`${hash}\` |`);
    }
    if (Object.keys(hashes).length === 0) {
        lines.push('| — | No hashes recorded (files missing) |');
    }

    lines.push('', '---', '');
    lines.push(`> This report was generated automatically by \`health-check.js\`.`);
    lines.push(`> It is read-only evidence. Do not edit after saving.`);

    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
    const args = process.argv.slice(2);
    const rootIdx = args.indexOf('--root');
    const root = rootIdx >= 0 && args[rootIdx + 1]
        ? path.resolve(args[rootIdx + 1])
        : DEFAULT_ROOT;

    console.log(`\nArchitecture Skill — Health Checker`);
    console.log(`Root: ${root}\n`);

    // Read version from manifest if available
    let version = 'unknown';
    const manifestPath = path.join(root, 'skill-manifest.json');
    if (fs.existsSync(manifestPath)) {
        try {
            const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            version = m.skill_version || version;
        } catch (_) { }
    }

    const allResults = [
        ...checkRequiredFiles(root),
        ...checkManifest(root),
        ...checkFrontmatter(root),
        ...checkConflictMarkers(root),
        ...checkExpectedSections(root),
    ];

    const { results: hashResults, hashes } = recordHashes(root);
    allResults.push(...hashResults);

    // Print to console
    for (const r of allResults) {
        const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⚠️ ';
        console.log(`  ${icon} ${r.status.padEnd(5)} ${r.message}`);
    }

    const failCount = allResults.filter(r => r.status === 'FAIL').length;
    console.log(`\nOverall: ${failCount === 0 ? 'HEALTHY ✅' : `UNHEALTHY ❌ (${failCount} failures)`}\n`);

    // Save report
    const reportDir = path.join(root, 'governance', 'health-reports');
    if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
    }

    const date = new Date().toISOString().slice(0, 10);
    const reportPath = path.join(reportDir, `health-report-${date}.md`);
    const reportContent = generateReport(allResults, hashes, root, version);
    fs.writeFileSync(reportPath, reportContent, 'utf8');
    console.log(`Report saved: ${reportPath}\n`);

    process.exit(failCount > 0 ? 1 : 0);
}

main();
