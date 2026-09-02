/**
 * Architecture Skill — Release Changelog Generator
 * Phase 1 implementation (GAP-004)
 *
 * Since Git is not yet in use, this reads the changelog array from
 * skill-manifest.json and produces a formatted CHANGELOG.md.
 *
 * Usage:
 *   node changelog-generate.js [--root <path>]
 *
 * Output:
 *   CHANGELOG.md in the root folder
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');

function main() {
    const args = process.argv.slice(2);
    const rootIdx = args.indexOf('--root');
    const root = rootIdx >= 0 && args[rootIdx + 1]
        ? path.resolve(args[rootIdx + 1])
        : DEFAULT_ROOT;

    const manifestPath = path.join(root, 'skill-manifest.json');
    if (!fs.existsSync(manifestPath)) {
        console.error(`skill-manifest.json not found at: ${manifestPath}`);
        process.exit(1);
    }

    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
        console.error(`Failed to parse skill-manifest.json: ${e.message}`);
        process.exit(1);
    }

    const entries = manifest.changelog || [];
    if (entries.length === 0) {
        console.warn('No changelog entries found in skill-manifest.json');
    }

    const lines = [
        `# Changelog — ${manifest.skill_name || 'Architecture Skill'}`,
        ``,
        `All notable changes to this skill are documented here.`,
        `Format follows [Keep a Changelog](https://keepachangelog.com/).`,
        ``,
        `> **Version source:** \`skill-manifest.json\`  `,
        `> Git tags are the recommended future mechanism once a repository is initialised.`,
        ``,
        `---`,
        ``,
    ];

    // Sort descending by version
    const sorted = [...entries].sort((a, b) => {
        const av = (a.version || '').split('.').map(Number);
        const bv = (b.version || '').split('.').map(Number);
        for (let i = 0; i < 3; i++) {
            if ((bv[i] || 0) !== (av[i] || 0)) return (bv[i] || 0) - (av[i] || 0);
        }
        return 0;
    });

    for (const entry of sorted) {
        lines.push(`## [${entry.version}] — ${entry.date || 'date unknown'}`);
        lines.push('');
        lines.push(`**Summary:** ${entry.summary || '—'}`);
        lines.push('');
        lines.push(`**Compatibility impact:** ${entry.compatibility_impact || '—'}`);
        lines.push('');
        lines.push(`**Approver:** ${entry.approver || '—'}`);
        lines.push('');
        lines.push('---');
        lines.push('');
    }

    const outPath = path.join(root, 'CHANGELOG.md');
    fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
    console.log(`\nCHANGELOG.md written to: ${outPath}\n`);
}

main();
