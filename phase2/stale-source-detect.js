/**
 * Architecture Skill — Stale Source Detector
 * Phase 2 implementation
 *
 * Purpose:
 *   Warns when an architecture artifact was generated from an older or
 *   mismatched PRD version. Compares the PRD hash stored in a prd-index
 *   or architecture JSON artifact against the current PRD hash on disk.
 *
 * Usage:
 *   node stale-source-detect.js --prd <current-prd.md> --index <prd-index.json>
 *   node stale-source-detect.js --prd <current-prd.md> --artifact <architecture.json>
 *
 * Exit codes:
 *   0  — Hashes match (source is current)
 *   1  — Hash mismatch (PRD changed after indexing / artifact generation)
 *   2  — Missing file or invalid input
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256File(filePath) {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
}

function loadJSON(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        console.error(`Failed to parse JSON: ${filePath} — ${e.message}`);
        process.exit(2);
    }
}

function check(prdPath, recordedHash, recordedAt, sourceFile) {
    if (!fs.existsSync(prdPath)) {
        console.error(`\n❌  STALE SOURCE: PRD file not found at: ${prdPath}`);
        console.error(`    The PRD path recorded in ${sourceFile} no longer resolves.`);
        console.error(`    Action: Locate the current approved PRD and re-run the indexer.\n`);
        process.exit(1);
    }

    const currentHash = sha256File(prdPath);

    console.log(`\nArchitecture Skill — Stale Source Detector`);
    console.log(`PRD path:        ${prdPath}`);
    console.log(`Recorded hash:   ${recordedHash}`);
    console.log(`Current hash:    ${currentHash}`);
    console.log(`Recorded at:     ${recordedAt || 'unknown'}`);
    console.log(`Source record:   ${sourceFile}\n`);

    if (currentHash === recordedHash) {
        console.log(`✅  SOURCE CURRENT — Hashes match.`);
        console.log(`    The PRD has not changed since the index/artifact was generated.\n`);
        process.exit(0);
    } else {
        console.error(`❌  STALE SOURCE DETECTED — Hash mismatch.`);
        console.error(`    The PRD on disk differs from the version used to generate the index or artifact.`);
        console.error(`    This means architecture work may have been done against an outdated PRD.`);
        console.error(`\n    Required actions:`);
        console.error(`      1. Confirm which PRD version is the current approved source.`);
        console.error(`      2. If the PRD was legitimately updated: re-run index_prd.js.`);
        console.error(`      3. If the PRD was not intentionally changed: restore the approved version.`);
        console.error(`      4. Do not use existing architecture artifacts until the source is reconciled.\n`);
        process.exit(1);
    }
}

function main() {
    const args = process.argv.slice(2);

    const prdIdx = args.indexOf('--prd');
    const indexIdx = args.indexOf('--index');
    const artifactIdx = args.indexOf('--artifact');

    if (prdIdx < 0 || !args[prdIdx + 1]) {
        console.error('\nUsage:');
        console.error('  node stale-source-detect.js --prd <current-prd.md> --index <prd-index.json>');
        console.error('  node stale-source-detect.js --prd <current-prd.md> --artifact <architecture.json>\n');
        process.exit(2);
    }

    const prdPath = path.resolve(args[prdIdx + 1]);

    // ── Mode 1: compare against prd-index JSON ────────────────────────────────

    if (indexIdx >= 0 && args[indexIdx + 1]) {
        const indexPath = path.resolve(args[indexIdx + 1]);
        if (!fs.existsSync(indexPath)) {
            console.error(`Index file not found: ${indexPath}`);
            process.exit(2);
        }
        const index = loadJSON(indexPath);
        const recordedHash = index?.source_hash?.hash || index?.metadata?.prd_sha256;
        const recordedAt = index?.source_hash?.timestamp || index?.metadata?.indexed_at;
        if (!recordedHash) {
            console.error(`No prd_sha256 or source_hash.hash found in: ${indexPath}`);
            process.exit(2);
        }
        check(prdPath, recordedHash, recordedAt, indexPath);
        return;
    }

    // ── Mode 2: compare against architecture artifact JSON ────────────────────

    if (artifactIdx >= 0 && args[artifactIdx + 1]) {
        const artifactPath = path.resolve(args[artifactIdx + 1]);
        if (!fs.existsSync(artifactPath)) {
            console.error(`Artifact file not found: ${artifactPath}`);
            process.exit(2);
        }
        const artifact = loadJSON(artifactPath);

        // Try common paths where source hash might live in an architecture JSON
        const recordedHash =
            artifact?.execution_metadata?.source_hash ||
            artifact?.metadata?.prd_sha256 ||
            artifact?.architecture?.metadata?.prd_sha256;

        const recordedAt =
            artifact?.execution_metadata?.started_at ||
            artifact?.metadata?.generated_date;

        if (!recordedHash) {
            console.error(`No source hash found in artifact: ${artifactPath}`);
            console.error(`Expected at: execution_metadata.source_hash or metadata.prd_sha256`);
            console.error(`Note: Architecture artifacts generated before Phase 2 will not have a hash.`);
            console.error(`      Re-generate the artifact with Phase 2 tooling to enable stale detection.`);
            process.exit(2);
        }

        check(prdPath, recordedHash, recordedAt, artifactPath);
        return;
    }

    console.error('\nProvide either --index <prd-index.json> or --artifact <architecture.json>\n');
    process.exit(2);
}

main();
