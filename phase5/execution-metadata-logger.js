/**
 * Architecture Skill — Execution Metadata Logger
 * Phase 5 implementation — §61 compliance
 *
 * Records execution metadata for enterprise architecture runs.
 * Called at the start and end of each architecture generation run.
 *
 * Usage:
 *   node execution-metadata-logger.js start --prd <prd-file> [--run-id <id>]
 *   node execution-metadata-logger.js complete --run-id <id> --artifact <artifact.json>
 *                                               [--validation-status PASS|FAIL]
 *                                               [--blocker-ids B-001,B-002]
 *
 * Output:
 *   phase5/execution-metadata/run-<run-id>.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256(filePath) {
    try { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }
    catch (_) { return 'unavailable'; }
}

function loadJSON(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (_) { return null; }
}

function generateRunId() {
    const now = new Date();
    const ts = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const rand = crypto.randomBytes(3).toString('hex');
    return `run-${ts}-${rand}`;
}

const DEFAULT_OUT = path.resolve(__dirname, 'execution-metadata');
const MANIFEST_PATH = path.resolve(__dirname, '..', 'skill-manifest.json');

function readSkillVersion() {
    const m = loadJSON(MANIFEST_PATH);
    return m?.skill_version || 'unknown';
}

// ── START action ──────────────────────────────────────────────────────────────

function actionStart(args) {
    const get = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
    const prdPath = get('--prd');
    const runId = get('--run-id') || generateRunId();
    const outDir = get('--out') ? path.resolve(get('--out')) : DEFAULT_OUT;
    const skillVer = readSkillVersion();
    const now = new Date().toISOString();

    const record = {
        run_id: runId,
        skill_version: skillVer,
        started_at: now,
        completed_at: null,
        prd_path: prdPath ? path.resolve(prdPath) : null,
        source_hashes: prdPath ? [{ file: prdPath, sha256: sha256(path.resolve(prdPath)) }] : [],
        artifact_hashes: [],
        validation_status: 'in_progress',
        blocker_ids: [],
        review_status: 'pending',
        status: 'started',
    };

    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${runId}.json`);
    fs.writeFileSync(outPath, JSON.stringify(record, null, 2), 'utf8');

    console.log(`\nExecution metadata logger — START`);
    console.log(`Run ID:        ${runId}`);
    console.log(`Skill version: ${skillVer}`);
    console.log(`PRD:           ${prdPath || '(not specified)'}`);
    console.log(`Record saved:  ${outPath}\n`);
    console.log(runId); // allow shell capture
}

// ── COMPLETE action ───────────────────────────────────────────────────────────

function actionComplete(args) {
    const get = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
    const runId = get('--run-id');
    const artifactPath = get('--artifact');
    const validationStatus = get('--validation-status') || 'unknown';
    const blockerIdsStr = get('--blocker-ids') || '';
    const reviewStatus = get('--review-status') || 'pending';
    const outDir = get('--out') ? path.resolve(get('--out')) : DEFAULT_OUT;

    if (!runId) {
        console.error('--run-id is required for complete action');
        process.exit(1);
    }

    const recordPath = path.join(outDir, `${runId}.json`);
    if (!fs.existsSync(recordPath)) {
        console.error(`Run record not found: ${recordPath}`);
        console.error('Start a run first with: node execution-metadata-logger.js start --prd <prd>');
        process.exit(1);
    }

    const record = loadJSON(recordPath);
    record.completed_at = new Date().toISOString();
    record.status = 'completed';
    record.validation_status = validationStatus;
    record.blocker_ids = blockerIdsStr ? blockerIdsStr.split(',').map(s => s.trim()) : [];
    record.review_status = reviewStatus;

    if (artifactPath && fs.existsSync(path.resolve(artifactPath))) {
        const absArtifact = path.resolve(artifactPath);
        record.artifact_hashes = [{
            file: artifactPath,
            sha256: sha256(absArtifact),
        }];
        // Try to read architecture version from artifact
        const artifact = loadJSON(absArtifact);
        if (artifact?.architecture?.metadata?.architecture_version) {
            record.artifact_architecture_version = artifact.architecture.metadata.architecture_version;
        }
    }

    const durationMs = record.started_at
        ? new Date(record.completed_at) - new Date(record.started_at)
        : null;
    if (durationMs !== null) record.duration_ms = durationMs;

    fs.writeFileSync(recordPath, JSON.stringify(record, null, 2), 'utf8');

    console.log(`\nExecution metadata logger — COMPLETE`);
    console.log(`Run ID:            ${runId}`);
    console.log(`Validation status: ${validationStatus}`);
    console.log(`Review status:     ${reviewStatus}`);
    console.log(`Blockers:          ${record.blocker_ids.join(', ') || 'none'}`);
    if (durationMs !== null) console.log(`Duration:          ${durationMs}ms`);
    console.log(`Record updated:    ${recordPath}\n`);
}

// ── LIST action ───────────────────────────────────────────────────────────────

function actionList(args) {
    const get = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
    const outDir = get('--out') ? path.resolve(get('--out')) : DEFAULT_OUT;

    if (!fs.existsSync(outDir)) {
        console.log('\nNo execution metadata directory found.\n');
        return;
    }

    const records = fs.readdirSync(outDir)
        .filter(f => f.startsWith('run-') && f.endsWith('.json'))
        .sort().reverse()
        .map(f => loadJSON(path.join(outDir, f)))
        .filter(Boolean);

    if (records.length === 0) {
        console.log('\nNo run records found.\n');
        return;
    }

    console.log(`\nExecution Metadata — ${records.length} run(s)\n`);
    console.log('Run ID'.padEnd(28) + 'Version'.padEnd(10) + 'Status'.padEnd(14) + 'Validation'.padEnd(12) + 'Started');
    console.log('─'.repeat(80));
    for (const r of records) {
        console.log(
            (r.run_id || '').padEnd(28) +
            (r.skill_version || '').padEnd(10) +
            (r.status || '').padEnd(14) +
            (r.validation_status || '').padEnd(12) +
            (r.started_at?.slice(0, 19).replace('T', ' ') || '')
        );
    }
    console.log('');
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
    const args = process.argv.slice(2);
    const action = args[0];

    if (!action || action === '--help') {
        console.log('\nUsage:');
        console.log('  node execution-metadata-logger.js start    --prd <prd.md> [--run-id <id>]');
        console.log('  node execution-metadata-logger.js complete --run-id <id> --artifact <artifact.json>');
        console.log('                                              [--validation-status PASS|FAIL]');
        console.log('                                              [--blocker-ids B-001,B-002]');
        console.log('  node execution-metadata-logger.js list\n');
        process.exit(0);
    }

    switch (action) {
        case 'start': actionStart(args.slice(1)); break;
        case 'complete': actionComplete(args.slice(1)); break;
        case 'list': actionList(args.slice(1)); break;
        default:
            console.error(`Unknown action: ${action}. Use start, complete, or list.`);
            process.exit(1);
    }
}

main();
