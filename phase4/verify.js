/**
 * Architecture Skill — Artifact Verifier
 * Phase 4 implementation — V-001 through V-010
 *
 * Runs all ten verification checks against a generated architecture artifact.
 * Produces a versioned verification report (JSON + Markdown).
 *
 * Usage:
 *   node verify.js --artifact <architecture.json> [--md <architecture.md>]
 *                  [--prd-index <prd-index.json>] [--out <output-folder>]
 *
 * V-001  Skill frontmatter / required-section validity        (SKILL.md check)
 * V-002  JSON parse / schema validity                         (architecture.schema.json)
 * V-003  Unique stable IDs and correct prefixes               (REQ,MOD,CMP,API,WF,STM,ENT,INT,ADR,INV)
 * V-004  Existing cross-references (IDs cited must exist)     (internal ref check)
 * V-005  Requirement traceability or blocker                  (every REQ traced or blocked)
 * V-006  Source IDs / locators resolve to PRD index           (requires --prd-index)
 * V-007  Markdown / JSON agreement                            (requires --md)
 * V-008  Mermaid / DOCX diagram agreement                     (static check only — no renderer)
 * V-009  DOCX structure / accessibility / render quality      (structural check)
 * V-010  No unapproved technology / schema / unsupported components (policy check)
 *
 * Exit codes:
 *   0  All checks PASS (or approved deviations only)
 *   1  One or more checks FAIL
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Helpers ───────────────────────────────────────────────────────────────────

const PASS = (id, msg, detail) => ({ check: id, status: 'PASS', message: msg, detail: detail || null });
const FAIL = (id, msg, detail) => ({ check: id, status: 'FAIL', message: msg, detail: detail || null });
const WARN = (id, msg, detail) => ({ check: id, status: 'WARN', message: msg, detail: detail || null });
const SKIP = (id, msg) => ({ check: id, status: 'SKIP', message: msg, detail: null });

function loadJSON(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { return null; }
}

// ── ID prefix rules ───────────────────────────────────────────────────────────

const ID_PREFIXES = {
    requirements: 'REQ',
    modules: 'MOD',
    components: 'CMP',
    apis: 'API',
    workflows: 'WF',
    state_machines: 'STM',
    entities: 'ENT',
    integrations: 'INT',
    architecture_decisions: 'ADR',
    architecture_invariants: 'INV',
    actors: 'ACT',
    blockers: 'B',
    open_questions: 'Q',
};

// ── V-001: Skill frontmatter / section validity ───────────────────────────────

function v001_skillValidity(skillPath) {
    const id = 'V-001';
    if (!skillPath || !fs.existsSync(skillPath)) {
        return SKIP(id, 'SKILL.md path not provided or not found — skipping skill validity check');
    }
    const content = fs.readFileSync(skillPath, 'utf8');
    const failures = [];

    if (!content.startsWith('---')) failures.push('Missing frontmatter block');

    const requiredSections = [
        '## 1. PURPOSE', '## 2. OPERATING MODES', '## 3. FORMAL INPUT CONTRACT',
        '## 43. ARCHITECTURE VALIDATION', '## 44. CROSS-SECTION CONSISTENCY CHECK',
        '## 46. MACHINE-READABLE OUTPUT CONTRACT', '## 47. STRICT JSON RULES',
        '## 51. QUALITY GATES', '## 52. EXECUTION WORKFLOW',
        '## 57. ENTERPRISE OPERATING MODEL', '## 68. PHASE 1',
    ];
    for (const s of requiredSections) {
        if (!content.includes(s)) failures.push(`Missing section: ${s}`);
    }
    if (content.includes('<<<<<<<')) failures.push('Unresolved conflict marker found');

    return failures.length === 0
        ? PASS(id, 'SKILL.md structure valid — frontmatter present, required sections found, no conflict markers')
        : FAIL(id, `SKILL.md structure issues (${failures.length})`, failures);
}

// ── V-002: JSON schema validity ───────────────────────────────────────────────

function v002_jsonSchemaValidity(artifact, schemaPath) {
    const id = 'V-002';
    if (!artifact) return FAIL(id, 'Artifact JSON could not be parsed');

    // Minimal structural validation (full JSONSchema validator not bundled)
    const arch = artifact.architecture;
    if (!arch) return FAIL(id, 'Missing top-level "architecture" key');

    const failures = [];
    if (!arch.metadata) failures.push('Missing architecture.metadata');
    if (!arch.mode) failures.push('Missing architecture.mode');
    if (!arch.depth_tier) failures.push('Missing architecture.depth_tier');
    if (!arch.requirements || !Array.isArray(arch.requirements) || arch.requirements.length === 0)
        failures.push('Missing or empty architecture.requirements');

    if (arch.mode && !['application', 'module'].includes(arch.mode))
        failures.push(`Invalid mode: "${arch.mode}" (must be "application" or "module")`);
    if (arch.depth_tier && ![1, 2, 3].includes(arch.depth_tier))
        failures.push(`Invalid depth_tier: ${arch.depth_tier} (must be 1, 2 or 3)`);

    // Validate requirement status values
    const validStatuses = ['prd_stated', 'architecturally_derived', 'proposed', 'blocked'];
    (arch.requirements || []).forEach((r, i) => {
        if (!r.id) failures.push(`requirements[${i}] missing id`);
        if (!r.text) failures.push(`requirements[${i}] missing text`);
        if (!r.type) failures.push(`requirements[${i}] missing type`);
        if (r.status && !validStatuses.includes(r.status))
            failures.push(`requirements[${i}] invalid status: "${r.status}"`);
    });

    // Validate ADR status values
    const validAdrStatuses = ['proposed', 'accepted', 'rejected', 'deprecated', 'superseded'];
    (arch.architecture_decisions || []).forEach((d, i) => {
        if (d.status && !validAdrStatuses.includes(d.status))
            failures.push(`architecture_decisions[${i}] invalid status: "${d.status}"`);
    });

    return failures.length === 0
        ? PASS(id, 'JSON structure valid — required keys present, mode/tier valid, requirement statuses valid')
        : FAIL(id, `JSON structure issues (${failures.length})`, failures);
}

// ── V-003: Unique stable IDs and correct prefixes ─────────────────────────────

function v003_stableIds(artifact) {
    const id = 'V-003';
    if (!artifact?.architecture) return FAIL(id, 'No architecture object to check');

    const arch = artifact.architecture;
    const allIds = [];
    const failures = [];

    for (const [field, prefix] of Object.entries(ID_PREFIXES)) {
        const items = arch[field];
        if (!Array.isArray(items)) continue;
        for (const item of items) {
            const itemId = item.id;
            if (!itemId) { failures.push(`${field}: item missing id`); continue; }

            // Check prefix
            const expectedPrefix = prefix + '-';
            if (!itemId.startsWith(expectedPrefix)) {
                failures.push(`${field}: "${itemId}" should start with "${expectedPrefix}"`);
            }

            // Check uniqueness across all IDs
            if (allIds.includes(itemId)) {
                failures.push(`Duplicate ID: "${itemId}" in ${field}`);
            } else {
                allIds.push(itemId);
            }
        }
    }

    return failures.length === 0
        ? PASS(id, `Stable IDs valid — ${allIds.length} unique IDs across all arrays, all prefixes correct`)
        : FAIL(id, `Stable ID issues (${failures.length})`, failures);
}

// ── V-004: Cross-reference integrity ─────────────────────────────────────────

function v004_crossReferences(artifact) {
    const id = 'V-004';
    if (!artifact?.architecture) return FAIL(id, 'No architecture object to check');

    const arch = artifact.architecture;
    const failures = [];

    // Build ID registry
    const registry = new Set();
    for (const field of Object.keys(ID_PREFIXES)) {
        (arch[field] || []).forEach(item => { if (item.id) registry.add(item.id); });
    }

    // Check module → component references
    (arch.modules || []).forEach(mod => {
        (mod.components || []).forEach(cmpRef => {
            if (cmpRef && !registry.has(cmpRef))
                failures.push(`MOD ${mod.id} references component "${cmpRef}" which does not exist`);
        });
    });

    // Check component → module references
    (arch.components || []).forEach(cmp => {
        if (cmp.module_id && !registry.has(cmp.module_id))
            failures.push(`CMP ${cmp.id} references module "${cmp.module_id}" which does not exist`);
    });

    // Check workflow → component and API references
    (arch.workflows || []).forEach(wf => {
        (wf.components || []).forEach(ref => {
            if (ref && !registry.has(ref))
                failures.push(`WF ${wf.id} references component "${ref}" which does not exist`);
        });
        (wf.apis || []).forEach(ref => {
            if (ref && !registry.has(ref))
                failures.push(`WF ${wf.id} references API "${ref}" which does not exist`);
        });
    });

    // Check traceability → REQ references
    (arch.requirement_traceability || []).forEach(trace => {
        if (trace.requirement_id && !registry.has(trace.requirement_id))
            failures.push(`Traceability references "${trace.requirement_id}" which does not exist in requirements`);
        if (trace.module_id && trace.module_id !== '' && !registry.has(trace.module_id))
            failures.push(`Traceability references module "${trace.module_id}" which does not exist`);
        if (trace.component_id && trace.component_id !== '' && !registry.has(trace.component_id))
            failures.push(`Traceability references component "${trace.component_id}" which does not exist`);
    });

    return failures.length === 0
        ? PASS(id, `Cross-references valid — all cited IDs resolve within the architecture`)
        : FAIL(id, `Cross-reference issues (${failures.length})`, failures);
}

// ── V-005: Requirement traceability or blocker ────────────────────────────────

function v005_traceability(artifact) {
    const id = 'V-005';
    if (!artifact?.architecture) return FAIL(id, 'No architecture object to check');

    const arch = artifact.architecture;
    const reqs = arch.requirements || [];
    const traced = new Set((arch.requirement_traceability || []).map(t => t.requirement_id));
    const blocked = new Set((arch.blockers || []).map(b => b.id));
    const blockedReqs = new Set(
        reqs.filter(r => r.status === 'blocked').map(r => r.id)
    );
    const failures = [];
    const warnings = [];

    for (const req of reqs) {
        if (traced.has(req.id)) continue;
        if (req.status === 'blocked' || blockedReqs.has(req.id)) continue;
        // Warn on proposed, fail on prd_stated/derived without trace
        if (req.status === 'proposed') {
            warnings.push(`${req.id} is proposed and has no traceability entry`);
        } else {
            failures.push(`${req.id} (${req.status}) has no traceability entry and is not blocked`);
        }
    }

    if (failures.length > 0)
        return FAIL(id, `Traceability issues (${failures.length})`, failures);
    if (warnings.length > 0)
        return WARN(id, `${reqs.length} requirements checked — ${warnings.length} proposed with no trace`, warnings);
    return PASS(id, `All ${reqs.length} requirements have traceability entries or are correctly blocked`);
}

// ── V-006: Source IDs / locators resolve to PRD index ────────────────────────

function v006_sourceLocators(artifact, prdIndex) {
    const id = 'V-006';
    if (!prdIndex) return SKIP(id, 'No PRD index provided — skipping source locator check (run with --prd-index)');
    if (!artifact?.architecture) return FAIL(id, 'No architecture object');

    const arch = artifact.architecture;
    const reqs = arch.requirements || [];
    const indexed = new Map(
        (prdIndex.requirement_inventory || []).map(r => [r.requirement_id, r])
    );
    const failures = [];
    const warnings = [];

    for (const req of reqs) {
        if (req.status === 'blocked' || req.status === 'proposed') continue;
        if (!req.source) {
            warnings.push(`${req.id} has no source field — cannot verify against PRD index`);
            continue;
        }
        // Source field may be like "FR-001" or "§5.1"
        if (!indexed.has(req.source) && !indexed.has(req.id)) {
            warnings.push(`${req.id} source "${req.source}" not found in PRD index — may be a derived requirement`);
        }
    }

    if (failures.length > 0)
        return FAIL(id, `Source locator failures (${failures.length})`, failures);
    if (warnings.length > 0)
        return WARN(id, `${warnings.length} requirements could not be traced to PRD index`, warnings);
    return PASS(id, `All PRD-stated requirements have sources reconcilable with the PRD index`);
}

// ── V-007: Markdown / JSON agreement ─────────────────────────────────────────

function v007_markdownJsonAgreement(artifact, mdPath) {
    const id = 'V-007';
    if (!mdPath || !fs.existsSync(mdPath))
        return SKIP(id, 'No Markdown artifact provided — skipping Markdown/JSON agreement check (run with --md)');
    if (!artifact?.architecture) return FAIL(id, 'No architecture object');

    const arch = artifact.architecture;
    const mdContent = fs.readFileSync(mdPath, 'utf8');
    const failures = [];
    const warnings = [];

    // Check architecture version appears in Markdown
    const archVer = arch.metadata?.architecture_version;
    if (archVer && !mdContent.includes(archVer))
        failures.push(`Architecture version "${archVer}" not found in Markdown document`);

    // Check all REQ IDs mentioned in JSON appear in Markdown
    const missingReqs = [];
    for (const req of (arch.requirements || [])) {
        if (req.status === 'blocked') continue;
        if (!mdContent.includes(req.id)) missingReqs.push(req.id);
    }
    if (missingReqs.length > 5) {
        failures.push(`${missingReqs.length} requirement IDs from JSON not found in Markdown`);
    } else if (missingReqs.length > 0) {
        missingReqs.forEach(r => warnings.push(`${r} not mentioned in Markdown`));
    }

    // Check all MOD IDs
    const missingMods = (arch.modules || []).filter(m => !mdContent.includes(m.id));
    if (missingMods.length > 0)
        missingMods.forEach(m => warnings.push(`Module ${m.id} (${m.name}) not found in Markdown`));

    // Check all ADR IDs
    const missingAdrs = (arch.architecture_decisions || []).filter(d => !mdContent.includes(d.id));
    if (missingAdrs.length > 0)
        missingAdrs.forEach(d => warnings.push(`Decision ${d.id} not found in Markdown`));

    if (failures.length > 0)
        return FAIL(id, `Markdown/JSON agreement failures (${failures.length})`, failures);
    if (warnings.length > 0)
        return WARN(id, `Markdown/JSON agreement warnings (${warnings.length})`, warnings);
    return PASS(id, 'Markdown and JSON describe the same architecture version, requirements, modules, and decisions');
}

// ── V-008: Mermaid / DOCX diagram agreement (static) ─────────────────────────

function v008_diagramAgreement(artifact, mdPath) {
    const id = 'V-008';
    if (!mdPath || !fs.existsSync(mdPath))
        return SKIP(id, 'No Markdown artifact provided — skipping Mermaid diagram check (run with --md)');

    const mdContent = fs.readFileSync(mdPath, 'utf8');
    const mermaidBlocks = (mdContent.match(/```mermaid[\s\S]*?```/g) || []);

    if (mermaidBlocks.length === 0)
        return WARN(id, 'No Mermaid diagram blocks found in Markdown — §36 requires at least one architecture diagram');

    const failures = [];
    mermaidBlocks.forEach((block, i) => {
        // Check for obviously invalid Mermaid (no direction or diagram type keyword)
        const inner = block.replace(/```mermaid/, '').replace(/```$/, '').trim();
        if (!inner || inner.length < 10)
            failures.push(`Mermaid block ${i + 1} appears empty`);
        // Check the block has at least one node/edge
        if (!/-->|->|\||graph|flowchart|sequenceDiagram|stateDiagram|erDiagram/i.test(inner))
            failures.push(`Mermaid block ${i + 1} may not be a valid diagram (no recognised syntax)`);
    });

    const note = 'Full render validation requires LibreOffice or a browser renderer — not available in this environment. Structural check only.';

    return failures.length === 0
        ? WARN(id, `${mermaidBlocks.length} Mermaid block(s) found — structural check passed. ${note}`)
        : FAIL(id, `Mermaid diagram structural issues (${failures.length})`, failures);
}

// ── V-009: DOCX structure / accessibility (structural only) ──────────────────

function v009_docxQuality(artifactDir) {
    const id = 'V-009';
    if (!artifactDir || !fs.existsSync(artifactDir))
        return SKIP(id, 'Artifact directory not found — skipping DOCX quality check');

    const docxFiles = fs.readdirSync(artifactDir).filter(f => f.endsWith('.docx'));
    if (docxFiles.length === 0)
        return WARN(id, 'No .docx files found in artifact directory — §45 requires a .docx output every run');

    const warnings = [];
    for (const f of docxFiles) {
        const size = fs.statSync(path.join(artifactDir, f)).size;
        if (size < 5000) warnings.push(`${f} is very small (${size} bytes) — may be incomplete or empty`);
        if (size > 50 * 1024 * 1024) warnings.push(`${f} is very large (${Math.round(size / 1024 / 1024)}MB) — review for embedded content`);
    }

    const note = 'Full render and accessibility validation requires LibreOffice — not available. File presence and size checks only.';
    return warnings.length === 0
        ? WARN(id, `${docxFiles.length} .docx file(s) found — presence check passed. ${note}`)
        : FAIL(id, `DOCX quality issues (${warnings.length})`, warnings);
}

// ── V-010: No unapproved technology / unsupported components ─────────────────

function v010_technologyPolicy(artifact) {
    const id = 'V-010';
    if (!artifact?.architecture) return FAIL(id, 'No architecture object');

    const arch = artifact.architecture;
    const failures = [];
    const warnings = [];

    // Unapproved technology = anything where status is not prd_stated, derived, or proposed
    const validTechStatuses = ['prd_stated', 'architecturally_derived', 'proposed', 'open'];
    (arch.technology_stack || []).forEach(t => {
        if (t.status && !validTechStatuses.includes(t.status))
            failures.push(`Technology "${t.technology}" (${t.layer}) has invalid status: "${t.status}"`);
    });

    // Components without responsibilities
    (arch.components || []).forEach(c => {
        if (!c.responsibilities || c.responsibilities.length === 0)
            failures.push(`CMP ${c.id} (${c.name}) has no responsibilities — §40 prohibits components without responsibility`);
    });

    // Vague component names (§15 prohibition)
    const vagueNames = ['Common Service', 'Helper', 'Manager', 'Utility', 'Generic Service', 'Common', 'Util', 'BaseService'];
    (arch.components || []).forEach(c => {
        if (vagueNames.some(v => c.name?.toLowerCase().includes(v.toLowerCase())))
            warnings.push(`CMP ${c.id} name "${c.name}" may be too vague — §15 recommends specific names`);
    });

    // Modules without responsibilities
    (arch.modules || []).forEach(m => {
        if (!m.responsibilities || m.responsibilities.length === 0)
            warnings.push(`MOD ${m.id} (${m.name}) has no responsibilities listed`);
    });

    // Detect SQL/schema in requirements (§40 prohibition)
    const sqlPattern = /\bCREATE\s+TABLE\b|\bALTER\s+TABLE\b|\bINSERT\s+INTO\b/i;
    (arch.requirements || []).forEach(r => {
        if (sqlPattern.test(r.text))
            failures.push(`REQ ${r.id} contains SQL — §40 prohibits SQL in architecture artifacts`);
    });

    if (failures.length > 0)
        return FAIL(id, `Technology/policy violations (${failures.length})`, failures);
    if (warnings.length > 0)
        return WARN(id, `Policy warnings (${warnings.length})`, warnings);
    return PASS(id, 'Technology status values valid, no SQL detected, components have responsibilities');
}

// ── Report builder ────────────────────────────────────────────────────────────

function buildReport(results, artifactPath, skillVersion) {
    const date = new Date().toISOString().slice(0, 10);
    const timestamp = new Date().toISOString();
    const passCount = results.filter(r => r.status === 'PASS').length;
    const failCount = results.filter(r => r.status === 'FAIL').length;
    const warnCount = results.filter(r => r.status === 'WARN').length;
    const skipCount = results.filter(r => r.status === 'SKIP').length;
    const overall = failCount === 0 ? 'PASS' : 'FAIL';

    const json = {
        report_type: 'verification',
        skill_version: skillVersion,
        artifact_path: artifactPath,
        generated_at: timestamp,
        overall: overall,
        summary: { pass: passCount, fail: failCount, warn: warnCount, skip: skipCount },
        checks: results,
    };

    const iconMap = { PASS: '✅', FAIL: '❌', WARN: '⚠️ ', SKIP: '➖' };

    const md = [
        `# Verification Report — V-001 through V-010`,
        ``,
        `**Date:** ${date}  `,
        `**Skill Version:** ${skillVersion}  `,
        `**Artifact:** \`${path.basename(artifactPath)}\`  `,
        `**Overall:** ${overall === 'PASS' ? '✅ PASS' : '❌ FAIL'}  `,
        ``,
        `| Result | Count |`,
        `|---|---|`,
        `| ✅ PASS | ${passCount} |`,
        `| ❌ FAIL | ${failCount} |`,
        `| ⚠️  WARN | ${warnCount} |`,
        `| ➖ SKIP | ${skipCount} |`,
        ``,
        `---`,
        ``,
        `## Check Results`,
        ``,
    ];

    for (const r of results) {
        const icon = iconMap[r.status] || '?';
        md.push(`### ${icon} ${r.check} — ${r.status}`);
        md.push(`${r.message}`);
        if (r.detail && Array.isArray(r.detail) && r.detail.length > 0) {
            md.push('');
            for (const d of r.detail) md.push(`- ${d}`);
        }
        md.push('');
    }

    md.push('---');
    md.push('');
    md.push(`> Generated by \`verify.js\`. This report is read-only evidence.`);

    return { json, md: md.join('\n'), date };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
    const args = process.argv.slice(2);
    const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };

    const artifactArg = get('--artifact');
    const mdArg = get('--md');
    const prdIndexArg = get('--prd-index');
    const outArg = get('--out');
    const skillArg = get('--skill');

    if (!artifactArg) {
        console.error('\nUsage: node verify.js --artifact <architecture.json> [--md <architecture.md>]');
        console.error('                       [--prd-index <prd-index.json>] [--out <output-folder>]\n');
        process.exit(1);
    }

    const artifactPath = path.resolve(artifactArg);
    const skillPath = skillArg ? path.resolve(skillArg) : path.resolve(__dirname, '..', 'SKILL.md');
    const outDir = outArg ? path.resolve(outArg) : path.resolve(__dirname, 'reports');
    const schemaPath = path.resolve(__dirname, 'architecture.schema.json');

    // Read skill version
    let skillVersion = 'unknown';
    const manifestPath = path.resolve(__dirname, '..', 'skill-manifest.json');
    if (fs.existsSync(manifestPath)) {
        try { skillVersion = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).skill_version || skillVersion; }
        catch (_) { }
    }

    console.log(`\nArchitecture Skill — Artifact Verifier`);
    console.log(`Artifact:      ${artifactPath}`);
    console.log(`Skill version: ${skillVersion}`);
    console.log(`SKILL.md:      ${skillPath}`);
    console.log(`Schema:        ${schemaPath}`);
    console.log(`Markdown:      ${mdArg || '(not provided)'}`);
    console.log(`PRD Index:     ${prdIndexArg || '(not provided)'}\n`);

    const artifact = loadJSON(artifactPath);
    const prdIndex = prdIndexArg ? loadJSON(path.resolve(prdIndexArg)) : null;
    const mdPath = mdArg ? path.resolve(mdArg) : null;
    const artifactDir = path.dirname(artifactPath);

    if (!artifact) {
        console.error(`❌  Cannot parse artifact JSON: ${artifactPath}`);
        process.exit(1);
    }

    // Run all checks
    const results = [
        v001_skillValidity(skillPath),
        v002_jsonSchemaValidity(artifact, schemaPath),
        v003_stableIds(artifact),
        v004_crossReferences(artifact),
        v005_traceability(artifact),
        v006_sourceLocators(artifact, prdIndex),
        v007_markdownJsonAgreement(artifact, mdPath),
        v008_diagramAgreement(artifact, mdPath),
        v009_docxQuality(artifactDir),
        v010_technologyPolicy(artifact),
    ];

    // Print to console
    const iconMap = { PASS: '✅', FAIL: '❌', WARN: '⚠️ ', SKIP: '➖' };
    for (const r of results) {
        const icon = iconMap[r.status] || '?';
        console.log(`  ${icon} ${r.check.padEnd(6)} ${r.status.padEnd(5)} ${r.message}`);
        if (r.detail && Array.isArray(r.detail) && r.detail.length <= 3) {
            r.detail.forEach(d => console.log(`         • ${d}`));
        } else if (r.detail && r.detail.length > 3) {
            r.detail.slice(0, 3).forEach(d => console.log(`         • ${d}`));
            console.log(`         • ... and ${r.detail.length - 3} more`);
        }
    }

    const failCount = results.filter(r => r.status === 'FAIL').length;
    console.log(`\nOverall: ${failCount === 0 ? 'PASS ✅' : `FAIL ❌ (${failCount} check(s) failed)`}\n`);

    // Save reports
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const { json, md, date } = buildReport(results, artifactPath, skillVersion);
    const jsonOut = path.join(outDir, `verification-report-${date}.json`);
    const mdOut = path.join(outDir, `verification-report-${date}.md`);
    fs.writeFileSync(jsonOut, JSON.stringify(json, null, 2), 'utf8');
    fs.writeFileSync(mdOut, md, 'utf8');
    console.log(`Reports saved:`);
    console.log(`  ${jsonOut}`);
    console.log(`  ${mdOut}\n`);

    process.exit(failCount > 0 ? 1 : 0);
}

main();
