/**
 * Architecture Skill — Change Diff Generator
 * Phase 1 implementation (GAP-002)
 *
 * Produces both:
 *   - Section-level diff  (for reviewers to understand meaning)
 *   - Line-level diff     (for exact audit evidence)
 *
 * Usage:
 *   node change-diff.js --old <path-to-old-SKILL.md> --new <path-to-new-SKILL.md>
 *
 * Output:
 *   governance/change-diffs/diff-<old-version>-to-<new-version>-<date>.md
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Section extraction
// ---------------------------------------------------------------------------

/**
 * Parse a markdown file into a map of { sectionHeading → content }.
 * Top-level (##) headings are used as section keys.
 */
function parseSections(content) {
    const lines = content.split('\n');
    const sections = new Map();
    let currentKey = '__PREAMBLE__';
    let buffer = [];

    for (const line of lines) {
        if (line.startsWith('## ')) {
            if (buffer.length) sections.set(currentKey, buffer.join('\n'));
            currentKey = line.trim();
            buffer = [line];
        } else {
            buffer.push(line);
        }
    }
    if (buffer.length) sections.set(currentKey, buffer.join('\n'));

    return sections;
}

// ---------------------------------------------------------------------------
// Line-level diff (unified diff, pure JS — no external dependency)
// ---------------------------------------------------------------------------

function unifiedDiff(oldLines, newLines, context = 3) {
    // Simple LCS-based unified diff
    const m = oldLines.length;
    const n = newLines.length;

    // Build LCS table
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
            if (oldLines[i] === newLines[j]) {
                dp[i][j] = 1 + dp[i + 1][j + 1];
            } else {
                dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
    }

    // Trace back to build edit script
    const edits = []; // { type: 'eq'|'del'|'ins', oldIdx, newIdx, text }
    let i = 0, j = 0;
    while (i < m || j < n) {
        if (i < m && j < n && oldLines[i] === newLines[j]) {
            edits.push({ type: 'eq', oldIdx: i, newIdx: j, text: oldLines[i] });
            i++; j++;
        } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
            edits.push({ type: 'ins', newIdx: j, text: newLines[j] });
            j++;
        } else {
            edits.push({ type: 'del', oldIdx: i, text: oldLines[i] });
            i++;
        }
    }

    // Group into hunks with context
    const hunks = [];
    let k = 0;
    while (k < edits.length) {
        if (edits[k].type !== 'eq') {
            // Start a hunk
            const start = Math.max(0, k - context);
            let end = k;
            // Extend to cover all non-eq in proximity
            while (end < edits.length) {
                if (edits[end].type !== 'eq') {
                    end = Math.min(edits.length - 1, end + context);
                } else {
                    // Count consecutive eq
                    let eqRun = 0;
                    let p = end;
                    while (p < edits.length && edits[p].type === 'eq') { eqRun++; p++; }
                    if (eqRun > context * 2) break;
                    end = p;
                }
                end++;
                if (end >= edits.length) break;
            }
            end = Math.min(edits.length - 1, end + context);
            hunks.push(edits.slice(start, end + 1));
            k = end + 1;
        } else {
            k++;
        }
    }

    if (hunks.length === 0) return null; // identical

    const diffLines = [];
    for (const hunk of hunks) {
        const oldStart = hunk.find(e => e.oldIdx !== undefined)?.oldIdx ?? 0;
        const newStart = hunk.find(e => e.newIdx !== undefined)?.newIdx ?? 0;
        const oldCount = hunk.filter(e => e.type !== 'ins').length;
        const newCount = hunk.filter(e => e.type !== 'del').length;
        diffLines.push(`@@ -${oldStart + 1},${oldCount} +${newStart + 1},${newCount} @@`);
        for (const e of hunk) {
            if (e.type === 'eq') diffLines.push(` ${e.text}`);
            if (e.type === 'del') diffLines.push(`-${e.text}`);
            if (e.type === 'ins') diffLines.push(`+${e.text}`);
        }
        diffLines.push('');
    }
    return diffLines.join('\n');
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function generateDiffReport(oldPath, newPath, oldVersion, newVersion) {
    const oldContent = fs.readFileSync(oldPath, 'utf8');
    const newContent = fs.readFileSync(newPath, 'utf8');

    const oldSections = parseSections(oldContent);
    const newSections = parseSections(newContent);

    const allKeys = new Set([...oldSections.keys(), ...newSections.keys()]);
    const date = new Date().toISOString().slice(0, 10);

    const lines = [
        `# Change Diff Report`,
        ``,
        `**From version:** ${oldVersion}  `,
        `**To version:** ${newVersion}  `,
        `**Date:** ${date}  `,
        `**Old file:** \`${path.basename(oldPath)}\`  `,
        `**New file:** \`${path.basename(newPath)}\`  `,
        ``,
        `---`,
        ``,
        `## Summary`,
        ``,
    ];

    const added = [];
    const removed = [];
    const modified = [];
    const unchanged = [];

    for (const key of allKeys) {
        if (key === '__PREAMBLE__') continue;
        const inOld = oldSections.has(key);
        const inNew = newSections.has(key);

        if (inOld && inNew) {
            if (oldSections.get(key) === newSections.get(key)) {
                unchanged.push(key);
            } else {
                modified.push(key);
            }
        } else if (!inOld && inNew) {
            added.push(key);
        } else {
            removed.push(key);
        }
    }

    lines.push(`| Change Type | Count |`);
    lines.push(`|---|---|`);
    lines.push(`| ✅ Added sections | ${added.length} |`);
    lines.push(`| ❌ Removed sections | ${removed.length} |`);
    lines.push(`| ✏️  Modified sections | ${modified.length} |`);
    lines.push(`| ➖ Unchanged sections | ${unchanged.length} |`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Section-level diff
    lines.push('## Section-Level Diff (Reviewer Summary)');
    lines.push('');

    if (added.length) {
        lines.push('### ✅ Sections Added');
        for (const s of added) lines.push(`- \`${s}\``);
        lines.push('');
    }

    if (removed.length) {
        lines.push('### ❌ Sections Removed');
        for (const s of removed) lines.push(`- \`${s}\``);
        lines.push('');
    }

    if (modified.length) {
        lines.push('### ✏️  Sections Modified');
        for (const s of modified) {
            lines.push(`#### ${s}`);
            lines.push('');
            const oldLines = oldSections.get(s).split('\n');
            const newLines = newSections.get(s).split('\n');
            const diff = unifiedDiff(oldLines, newLines);
            if (diff) {
                lines.push('```diff');
                lines.push(diff);
                lines.push('```');
            } else {
                lines.push('_No line-level differences detected._');
            }
            lines.push('');
        }
    }

    // Full line-level diff
    lines.push('---');
    lines.push('');
    lines.push('## Full Line-Level Diff (Audit Evidence)');
    lines.push('');
    const oldAllLines = oldContent.split('\n');
    const newAllLines = newContent.split('\n');
    const fullDiff = unifiedDiff(oldAllLines, newAllLines, 3);

    if (fullDiff) {
        lines.push('```diff');
        lines.push(fullDiff);
        lines.push('```');
    } else {
        lines.push('_Files are identical at the line level._');
    }

    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(`> Generated by \`change-diff.js\`. Read-only audit evidence.`);

    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
    const args = process.argv.slice(2);

    const oldIdx = args.indexOf('--old');
    const newIdx = args.indexOf('--new');

    if (oldIdx < 0 || newIdx < 0 || !args[oldIdx + 1] || !args[newIdx + 1]) {
        console.error('Usage: node change-diff.js --old <old-SKILL.md> --new <new-SKILL.md>');
        process.exit(1);
    }

    const oldPath = path.resolve(args[oldIdx + 1]);
    const newPath = path.resolve(args[newIdx + 1]);

    if (!fs.existsSync(oldPath)) { console.error(`Old file not found: ${oldPath}`); process.exit(1); }
    if (!fs.existsSync(newPath)) { console.error(`New file not found: ${newPath}`); process.exit(1); }

    // Try to read versions from adjacent skill-manifest.json files
    function readVersion(filePath, fallback) {
        const dir = path.dirname(filePath);
        const mp = path.join(dir, 'skill-manifest.json');
        if (fs.existsSync(mp)) {
            try { return JSON.parse(fs.readFileSync(mp, 'utf8')).skill_version || fallback; } catch (_) { }
        }
        return fallback;
    }

    const oldVersion = readVersion(oldPath, 'v1.0.0');
    const newVersion = readVersion(newPath, 'v1.1.0');

    console.log(`\nGenerating diff: ${oldVersion} → ${newVersion}\n`);

    const report = generateDiffReport(oldPath, newPath, oldVersion, newVersion);

    // Save
    const outDir = path.join(path.dirname(newPath), 'governance', 'change-diffs');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const date = new Date().toISOString().slice(0, 10);
    const filename = `diff-${oldVersion}-to-${newVersion}-${date}.md`
        .replace(/[^a-zA-Z0-9.\-_]/g, '-');
    const outPath = path.join(outDir, filename);

    fs.writeFileSync(outPath, report, 'utf8');
    console.log(`Diff report saved: ${outPath}\n`);
}

main();
