/**
 * Architecture Skill — Metrics Report Generator
 * Phase 5 implementation — §66 compliance
 *
 * Reads execution metadata records and produces a periodic metrics report
 * covering run success rate, validation failures, blocker frequency,
 * and elapsed time.
 *
 * Usage:
 *   node metrics-report.js [--out <output-folder>] [--since <YYYY-MM-DD>]
 *
 * Output:
 *   phase5/metrics/metrics-report-<date>.json
 *   phase5/metrics/metrics-report-<date>.md
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_METADATA_DIR = path.resolve(__dirname, 'execution-metadata');
const DEFAULT_OUT = path.resolve(__dirname, 'metrics');

function loadJSON(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (_) { return null; }
}

function main() {
    const args = process.argv.slice(2);
    const get = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
    const metaDir = get('--metadata') ? path.resolve(get('--metadata')) : DEFAULT_METADATA_DIR;
    const outDir = get('--out') ? path.resolve(get('--out')) : DEFAULT_OUT;
    const since = get('--since') || null;

    // Read skill version
    let skillVersion = 'unknown';
    try { skillVersion = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'skill-manifest.json'), 'utf8')).skill_version; }
    catch (_) { }

    console.log(`\nArchitecture Skill — Metrics Report`);
    console.log(`Skill version:  ${skillVersion}`);
    console.log(`Metadata dir:   ${metaDir}\n`);

    // Load all completed run records
    let records = [];
    if (fs.existsSync(metaDir)) {
        records = fs.readdirSync(metaDir)
            .filter(f => f.startsWith('run-') && f.endsWith('.json'))
            .map(f => loadJSON(path.join(metaDir, f)))
            .filter(r => r && r.status === 'completed');
    }

    // Filter by since date
    if (since) {
        records = records.filter(r => r.started_at >= since);
    }

    const date = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();

    // ── Compute metrics ─────────────────────────────────────────────────────────

    const total = records.length;
    const passed = records.filter(r => r.validation_status === 'PASS').length;
    const failed = records.filter(r => r.validation_status === 'FAIL').length;
    const inProgress = records.filter(r => r.validation_status === 'in_progress').length;
    const successRate = total > 0 ? ((passed / total) * 100).toFixed(1) : 'N/A';

    // Blocker frequency
    const blockerCounts = {};
    for (const r of records) {
        for (const b of (r.blocker_ids || [])) {
            blockerCounts[b] = (blockerCounts[b] || 0) + 1;
        }
    }

    // Average duration
    const durations = records.filter(r => r.duration_ms).map(r => r.duration_ms);
    const avgDuration = durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null;

    // Review status breakdown
    const approvedCount = records.filter(r => r.review_status === 'approved-for-release').length;
    const pendingCount = records.filter(r => r.review_status === 'pending').length;
    const blockedCount = records.filter(r => r.review_status?.includes('blocked')).length;

    const metrics = {
        report_type: 'metrics',
        skill_version: skillVersion,
        generated_at: now,
        period_since: since || 'all-time',
        total_runs: total,
        passed_runs: passed,
        failed_runs: failed,
        in_progress_runs: inProgress,
        success_rate_pct: successRate,
        avg_duration_ms: avgDuration,
        blocker_frequency: blockerCounts,
        review_status_breakdown: {
            approved: approvedCount,
            pending: pendingCount,
            blocked: blockedCount,
        },
    };

    // ── Build Markdown report ───────────────────────────────────────────────────

    const md = [
        `# Metrics Report — Architecture Skill v${skillVersion}`,
        ``,
        `**Date:** ${date}  `,
        `**Period:** ${since ? `Since ${since}` : 'All-time'}  `,
        `**Skill Version:** ${skillVersion}  `,
        ``,
        `---`,
        ``,
        `## Run Summary`,
        ``,
        `| Metric | Value |`,
        `|---|---|`,
        `| Total runs | ${total} |`,
        `| Passed (validation) | ${passed} |`,
        `| Failed (validation) | ${failed} |`,
        `| Success rate | ${successRate}${successRate !== 'N/A' ? '%' : ''} |`,
        `| Avg duration | ${avgDuration !== null ? `${avgDuration}ms` : 'N/A'} |`,
        ``,
        `## Review Status`,
        ``,
        `| Status | Count |`,
        `|---|---|`,
        `| Approved for release | ${approvedCount} |`,
        `| Pending review | ${pendingCount} |`,
        `| Blocked | ${blockedCount} |`,
        ``,
    ];

    if (Object.keys(blockerCounts).length > 0) {
        md.push(`## Most Frequent Blockers`);
        md.push('');
        md.push('| Blocker ID | Occurrences |');
        md.push('|---|---|');
        const sorted = Object.entries(blockerCounts).sort((a, b) => b[1] - a[1]);
        for (const [bid, count] of sorted) {
            md.push(`| ${bid} | ${count} |`);
        }
        md.push('');
    } else {
        md.push('## Most Frequent Blockers');
        md.push('');
        md.push('No blocker data recorded yet.');
        md.push('');
    }

    if (total === 0) {
        md.push('---');
        md.push('');
        md.push('> No completed run records found. Run architecture generation with the execution metadata logger to begin tracking metrics.');
    } else {
        md.push('---');
        md.push('');
        md.push(`> Generated from ${total} completed run record(s) in \`phase5/execution-metadata/\`.`);
    }

    // ── Write outputs ───────────────────────────────────────────────────────────

    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const jsonOut = path.join(outDir, `metrics-report-${date}.json`);
    const mdOut = path.join(outDir, `metrics-report-${date}.md`);
    fs.writeFileSync(jsonOut, JSON.stringify(metrics, null, 2), 'utf8');
    fs.writeFileSync(mdOut, md.join('\n'), 'utf8');

    // Console summary
    console.log(`Total runs:    ${total}`);
    console.log(`Success rate:  ${successRate}${successRate !== 'N/A' ? '%' : ''}`);
    console.log(`Avg duration:  ${avgDuration !== null ? `${avgDuration}ms` : 'N/A'}`);
    console.log(`Approved:      ${approvedCount}  |  Pending: ${pendingCount}  |  Blocked: ${blockedCount}`);
    if (total === 0) console.log('\n(No run records yet — log runs with execution-metadata-logger.js)');
    console.log(`\nReports saved:`);
    console.log(`  ${jsonOut}`);
    console.log(`  ${mdOut}\n`);
}

main();
