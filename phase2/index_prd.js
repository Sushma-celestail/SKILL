/**
 * Architecture Skill — PRD Indexer + Source Hash Generator
 * Phase 2 implementation
 *
 * Purpose:
 *   1. Parse a PRD (.md or .docx text) and produce a structured
 *      requirement inventory (JSON) matching the §60 Source Index Contract.
 *   2. Calculate a SHA-256 hash of the source PRD so downstream tools can
 *      detect whether the PRD changed after indexing.
 *   3. Record source path, hash, extraction timestamp, and skill version in
 *      an execution metadata record (§61 format).
 *
 * Usage:
 *   node index_prd.js --prd <path-to-prd.md> [--out <output-folder>] [--skill-version <ver>]
 *
 * Outputs (written to --out folder, default: phase2/indexes/):
 *   prd-index-<date>.json          Structured requirement inventory
 *   prd-source-hash-<date>.json    Source hash + metadata record
 *
 * Supported PRD format: Markdown (.md)
 * For .docx PRDs: extract text first with a tool such as mammoth, then pass the .md output.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_OUT_DIR = path.resolve(__dirname, 'indexes');
const DEFAULT_SKILL_VER = readManifestVersion();

// ── Requirement type detection keywords ──────────────────────────────────────

const TYPE_PATTERNS = [
    { type: 'security', patterns: [/\bsecurity\b/i, /\bauthentication\b/i, /\bauthorization\b/i, /\bencrypt/i, /\baccess.control\b/i] },
    { type: 'performance', patterns: [/\bperformance\b/i, /\blatency\b/i, /\bresponse.time\b/i, /\bthroughput\b/i, /\bsla\b/i] },
    { type: 'integration', patterns: [/\bintegrat/i, /\bapi\b/i, /\bwebhook\b/i, /\bthird.party\b/i, /\bexternal.system\b/i] },
    { type: 'data', patterns: [/\bdata\b/i, /\bdatabase\b/i, /\bstorage\b/i, /\bpersist/i, /\bmigration\b/i] },
    { type: 'non_functional', patterns: [/\bavailability\b/i, /\breliability\b/i, /\bscalability\b/i, /\buptime\b/i, /\bcompliance\b/i, /\baudit\b/i] },
    { type: 'business_rule', patterns: [/\bmust\b/i, /\bshall\b/i, /\bbusiness.rule\b/i, /\bpolicy\b/i, /\bworkflow\b/i] },
    { type: 'actor', patterns: [/\buser\b/i, /\badmin/i, /\bmanager\b/i, /\bcustomer\b/i, /\brole\b/i] },
    { type: 'functional', patterns: [/.*/] }, // catch-all
];

// ── Source status detection ───────────────────────────────────────────────────

const STATUS_PATTERNS = [
    { status: 'prd_stated', patterns: [/\[PRD-STATED\]/i, /\bshall\b/i, /\bmust\b/i, /\bwill\b/i, /\brequired\b/i] },
    { status: 'architecturally_derived', patterns: [/\[DERIVED\]/i] },
    { status: 'proposed', patterns: [/\[PROPOSED\]/i, /\brecommend/i, /\bpropose/i] },
    { status: 'blocked', patterns: [/\[BLOCKED\]/i, /\bblocked\b/i, /\bunresolved\b/i, /\bTBD\b/] },
];

// ── Current/target state detection ───────────────────────────────────────────

const STATE_PATTERNS = [
    { state: 'current_state', patterns: [/\bcurrent.state\b/i, /\bas.is\b/i, /\blegacy\b/i, /\bexisting\b/i] },
    { state: 'target_state', patterns: [/.*/] }, // default
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function readManifestVersion() {
    const candidates = [
        path.resolve(__dirname, '..', 'skill-manifest.json'),
        path.resolve(__dirname, 'skill-manifest.json'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            try { return JSON.parse(fs.readFileSync(p, 'utf8')).skill_version || 'unknown'; }
            catch (_) { }
        }
    }
    return 'unknown';
}

function sha256File(filePath) {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
}

function sha256String(str) {
    return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function detectType(text) {
    for (const { type, patterns } of TYPE_PATTERNS) {
        if (patterns.some(p => p.test(text))) return type;
    }
    return 'functional';
}

function detectStatus(text) {
    for (const { status, patterns } of STATUS_PATTERNS) {
        if (patterns.some(p => p.test(text))) return status;
    }
    return 'prd_stated';
}

function detectState(text, sectionText) {
    const combined = text + ' ' + sectionText;
    for (const { state, patterns } of STATE_PATTERNS) {
        if (state !== 'target_state' && patterns.some(p => p.test(combined))) return state;
    }
    return 'target_state';
}

function slugify(str) {
    return str.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 60);
}

// ── Section parser: splits Markdown into sections by heading level ─────────────

function parseSections(content) {
    const lines = content.split('\n');
    const sections = [];
    let current = { heading: '__PREAMBLE__', level: 0, lines: [], lineStart: 0 };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^(#{1,6})\s+(.+)/);
        if (match) {
            if (current.lines.length) sections.push(current);
            current = {
                heading: match[2].trim(),
                level: match[1].length,
                lines: [line],
                lineStart: i + 1,
            };
        } else {
            current.lines.push(line);
        }
    }
    if (current.lines.length) sections.push(current);
    return sections;
}

// ── Requirement extractor ─────────────────────────────────────────────────────

/**
 * Extracts requirement candidates from a section's text.
 * Handles:
 *   - Plain IDs:            FR-001  NFR-001  BR-001  REQ-001
 *   - Escaped IDs (mammoth):FR\-001  NFR\-001  BR\-001
 *   - Table cell IDs:       | FR-001 | description |
 *   - Numbered list items with requirement language
 *   - Bullet items with requirement language
 */
function extractRequirementsFromSection(section, sectionIndex) {
    const requirements = [];
    const text = section.lines.join('\n');
    const lines = section.lines;

    // Clean escaped backslashes that mammoth adds (e.g. FR\-001 → FR-001)
    const cleanLine = (l) => l.replace(/\\-/g, '-').replace(/\\_/g, '_').replace(/\\\./g, '.');

    // Pattern 1a: Plain explicit IDs at start of line
    const explicitIdPlain = /^[>\s*-]*([A-Z]{1,5}-\d{3,})[:\s]+(.+)/;
    // Pattern 1b: Escaped IDs (mammoth output)
    const explicitIdEscaped = /^[>\s*-]*([A-Z]{1,5}\\-\d{3,})[:\s]+(.+)/;
    // Pattern 1c: Table cell — | ID | text |
    const tableCellId = /^\|?\s*([A-Z]{1,5}[-\\]\d{3,})\s*\|(.+)/;

    // Pattern 2: Numbered list with requirement language
    const numberedPattern = /^\s*\d+\.\s+(.{20,})/;
    // Pattern 3: Bullet with requirement language
    const bulletPattern = /^\s*[-*+]\s+(.{20,})/;

    // Requirement-language signal words
    const reqSignals = /\b(must|shall|will|should|required|need to|needs to|has to|have to|allows?|enables?|supports?|provides?|ensures?)\b/i;

    let reqCounter = 1;

    for (let li = 0; li < lines.length; li++) {
        const rawLine = lines[li];
        const line = rawLine.trim();
        const cleaned = cleanLine(line);

        if (!line || line.startsWith('```') || line.startsWith('<!--')) continue;

        let reqId = null;
        let reqText = null;

        // 1a: plain explicit ID
        const m1a = cleaned.match(explicitIdPlain);
        if (m1a) {
            reqId = m1a[1];
            reqText = m1a[2].trim();
        }
        // 1b: escaped ID (raw line before cleaning)
        else {
            const m1b = line.match(explicitIdEscaped);
            if (m1b) {
                reqId = m1b[1].replace(/\\/g, '');
                reqText = cleanLine(m1b[2]).trim();
            }
        }
        // 1c: table cell ID
        if (!reqId) {
            const m1c = cleaned.match(tableCellId);
            if (m1c) {
                const candidate = m1c[1].replace(/\\/g, '');
                const desc = m1c[2].replace(/\|.*$/, '').trim();
                // Only count if it looks like a real ID (letter prefix + dash + 3 digits)
                if (/^[A-Z]{1,5}-\d{3,}$/.test(candidate) && desc.length > 5) {
                    reqId = candidate;
                    reqText = desc;
                }
            }
        }

        // 2: numbered list
        if (!reqId && !reqText) {
            if (numberedPattern.test(cleaned) && reqSignals.test(cleaned)) {
                const m = cleaned.match(numberedPattern);
                reqText = m[1].trim();
            }
        }

        // 3: bullet list
        if (!reqId && !reqText) {
            if (bulletPattern.test(cleaned) && reqSignals.test(cleaned)) {
                const m = cleaned.match(bulletPattern);
                reqText = m[1].trim();
            }
        }

        if (!reqText || reqText.length < 10) continue;
        // Skip pure navigation / table-of-contents lines
        if (/^\s*(page|section|diagram|figure)\s*\d/i.test(reqText)) continue;
        // Skip lines that are just IDs with no description
        if (/^[A-Z]{1,5}-\d{3,}\s*$/.test(reqText)) continue;

        const locator = `${section.heading}:L${section.lineStart + li}`;

        requirements.push({
            source_locator: locator,
            requirement_id: reqId || `AUTO-${String(sectionIndex).padStart(2, '0')}-${String(reqCounter).padStart(3, '0')}`,
            title: reqText.slice(0, 120),
            type: detectType(reqText + ' ' + section.heading),
            source_status: detectStatus(reqText),
            module: section.heading,
            current_or_target: detectState(reqText, text),
            open_question_ids: extractOpenQuestions(cleaned),
            section_heading: section.heading,
            line_number: section.lineStart + li,
            explicit_id: reqId !== null,
        });

        reqCounter++;
    }

    return requirements;
}

function extractOpenQuestions(text) {
    const ids = [];
    const matches = text.matchAll(/\b(Q-\d+|B-\d+)\b/g);
    for (const m of matches) ids.push(m[1]);
    return ids;
}

// ── Section inventory builder ─────────────────────────────────────────────────

function buildSectionInventory(sections) {
    return sections
        .filter(s => s.heading !== '__PREAMBLE__')
        .map((s, i) => ({
            index: i + 1,
            heading: s.heading,
            level: s.level,
            line_start: s.lineStart,
            line_count: s.lines.length,
            word_count: s.lines.join(' ').split(/\s+/).filter(Boolean).length,
            has_table: s.lines.some(l => l.includes('|')),
            has_code_block: s.lines.some(l => l.trim().startsWith('```')),
        }));
}

// ── Stale attachment detector ─────────────────────────────────────────────────

function detectAttachments(content) {
    const attachmentPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
    const attachments = [];
    let m;
    while ((m = attachmentPattern.exec(content)) !== null) {
        const href = m[2];
        // Only local paths
        if (!href.startsWith('http') && !href.startsWith('#')) {
            attachments.push({ label: m[1], path: href });
        }
    }
    return attachments;
}

// ── Main indexer ─────────────────────────────────────────────────────────────

function indexPRD(prdPath, outDir, skillVersion) {
    if (!fs.existsSync(prdPath)) {
        console.error(`PRD file not found: ${prdPath}`);
        process.exit(1);
    }

    const content = fs.readFileSync(prdPath, 'utf8');
    const fileHash = sha256File(prdPath);
    const contentLen = content.length;
    const now = new Date().toISOString();
    const date = now.slice(0, 10);

    console.log(`\nArchitecture Skill — PRD Indexer`);
    console.log(`PRD:           ${prdPath}`);
    console.log(`SHA-256:       ${fileHash}`);
    console.log(`Skill version: ${skillVersion}`);
    console.log(`Timestamp:     ${now}\n`);

    // 1. Parse sections
    const sections = parseSections(content);
    const sectionInventory = buildSectionInventory(sections);

    // 2. Extract requirements section by section
    const allRequirements = [];
    for (let i = 0; i < sections.length; i++) {
        const reqs = extractRequirementsFromSection(sections[i], i);
        allRequirements.push(...reqs);
    }

    // 3. Deduplicate by explicit ID (keep first occurrence)
    const seen = new Set();
    const uniqueReqs = [];
    for (const r of allRequirements) {
        const key = r.explicit_id ? r.requirement_id : `${r.section_heading}:${r.title.slice(0, 40)}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueReqs.push(r);
        }
    }

    // 4. Detect local attachments and check if they exist
    const attachments = detectAttachments(content);
    const prdDir = path.dirname(prdPath);
    const attachmentChecks = attachments.map(a => ({
        ...a,
        resolved_path: path.resolve(prdDir, a.path),
        exists: fs.existsSync(path.resolve(prdDir, a.path)),
        status: fs.existsSync(path.resolve(prdDir, a.path)) ? 'ok' : 'missing',
    }));
    const staleAttachments = attachmentChecks.filter(a => !a.exists);

    // 5. Word count estimate (rough token proxy: ~1.3 words per token)
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    const estimatedTokens = Math.round(wordCount / 1.3);

    // ── Build index output ────────────────────────────────────────────────────

    const prdIndex = {
        metadata: {
            index_version: '1.0',
            schema_version: 'phase2-v1',
            skill_version: skillVersion,
            prd_path: prdPath,
            prd_filename: path.basename(prdPath),
            prd_sha256: fileHash,
            indexed_at: now,
            content_length: contentLen,
            word_count: wordCount,
            estimated_tokens: estimatedTokens,
            section_count: sectionInventory.length,
            requirement_count: uniqueReqs.length,
            explicit_id_count: uniqueReqs.filter(r => r.explicit_id).length,
            auto_id_count: uniqueReqs.filter(r => !r.explicit_id).length,
            stale_attachment_count: staleAttachments.length,
        },

        source_hash: {
            algorithm: 'SHA-256',
            hash: fileHash,
            path: prdPath,
            timestamp: now,
        },

        section_inventory: sectionInventory,

        requirement_inventory: uniqueReqs.map(r => ({
            source_locator: r.source_locator,
            requirement_id: r.requirement_id,
            title: r.title,
            type: r.type,
            source_status: r.source_status,
            module: r.module,
            current_or_target: r.current_or_target,
            open_question_ids: r.open_question_ids,
        })),

        attachment_checks: attachmentChecks,

        stale_source_warnings: staleAttachments.length > 0
            ? staleAttachments.map(a => ({
                type: 'missing_attachment',
                path: a.path,
                label: a.label,
                impact: 'Referenced file not found — potential stale source or broken link',
                action: 'Locate and provide the current version of the referenced file',
            }))
            : [],

        extraction_summary: {
            sections_parsed: sectionInventory.length,
            requirements_extracted: uniqueReqs.length,
            explicit_ids_found: uniqueReqs.filter(r => r.explicit_id).length,
            auto_assigned_ids: uniqueReqs.filter(r => !r.explicit_id).length,
            types_found: [...new Set(uniqueReqs.map(r => r.type))],
            modules_identified: [...new Set(uniqueReqs.map(r => r.module))],
            stale_attachments: staleAttachments.length,
            integrity_status: staleAttachments.length === 0 ? 'clean' : 'warnings',
        },
    };

    // ── Build source hash record (§61 execution metadata subset) ──────────────

    const sourceHashRecord = {
        record_type: 'source_hash',
        skill_version: skillVersion,
        prd_path: prdPath,
        prd_filename: path.basename(prdPath),
        prd_sha256: fileHash,
        indexed_at: now,
        requirement_count: uniqueReqs.length,
        stale_attachments: staleAttachments.length,
        integrity_status: staleAttachments.length === 0 ? 'clean' : 'warnings',
        usage_instruction: 'Compare prd_sha256 against this record before using the index. ' +
            'If hashes differ, the PRD changed after indexing — re-run index_prd.js.',
    };

    // ── Write outputs ──────────────────────────────────────────────────────────

    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const indexPath = path.join(outDir, `prd-index-${date}.json`);
    const hashPath = path.join(outDir, `prd-source-hash-${date}.json`);

    fs.writeFileSync(indexPath, JSON.stringify(prdIndex, null, 2), 'utf8');
    fs.writeFileSync(hashPath, JSON.stringify(sourceHashRecord, null, 2), 'utf8');

    // ── Console summary ────────────────────────────────────────────────────────

    console.log(`Sections parsed:        ${sectionInventory.length}`);
    console.log(`Requirements extracted: ${uniqueReqs.length}`);
    console.log(`  - Explicit IDs:       ${uniqueReqs.filter(r => r.explicit_id).length}`);
    console.log(`  - Auto-assigned IDs:  ${uniqueReqs.filter(r => !r.explicit_id).length}`);
    console.log(`Stale attachments:      ${staleAttachments.length}`);
    console.log(`Estimated tokens:       ~${estimatedTokens}`);
    console.log(`Integrity status:       ${staleAttachments.length === 0 ? 'CLEAN ✅' : 'WARNINGS ⚠️'}`);
    console.log(`\nIndex saved:            ${indexPath}`);
    console.log(`Hash record saved:      ${hashPath}\n`);

    if (staleAttachments.length > 0) {
        console.warn(`⚠️  ${staleAttachments.length} stale attachment(s) detected:`);
        for (const a of staleAttachments) {
            console.warn(`   MISSING: ${a.path} (label: "${a.label}")`);
        }
        console.warn('');
    }

    return { indexPath, hashPath, prdIndex, sourceHashRecord };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function main() {
    const args = process.argv.slice(2);

    const prdIdx = args.indexOf('--prd');
    const outIdx = args.indexOf('--out');
    const verIdx = args.indexOf('--skill-version');

    if (prdIdx < 0 || !args[prdIdx + 1]) {
        console.error('\nUsage: node index_prd.js --prd <path-to-prd.md> [--out <output-folder>] [--skill-version <ver>]');
        console.error('Example: node index_prd.js --prd "../PRD Internal Service Desk Tool_V1.md" --out phase2/indexes\n');
        process.exit(1);
    }

    const prdPath = path.resolve(args[prdIdx + 1]);
    const outDir = outIdx >= 0 && args[outIdx + 1]
        ? path.resolve(args[outIdx + 1])
        : DEFAULT_OUT_DIR;
    const skillVersion = verIdx >= 0 && args[verIdx + 1]
        ? args[verIdx + 1]
        : DEFAULT_SKILL_VER;

    indexPRD(prdPath, outDir, skillVersion);
}

main();
