/** Phase 3 routing fixture runner. Writes JSON and Markdown evidence reports. */
'use strict';
const fs = require('fs');
const path = require('path');
const { buildRoutingRecord } = require('./tier-routing');

const root = path.resolve(__dirname);
const fixtureDir = path.join(root, 'fixtures');
const reportDir = path.join(root, 'reports');
const date = new Date().toISOString().slice(0, 10);
const fixtures = fs.readdirSync(fixtureDir).filter((name) => name.endsWith('.json')).sort();
const results = fixtures.map((name) => {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
  try {
    const record = buildRoutingRecord(fixture.input, fixture.override || null);
    const pass = record.initial_decision.tier === fixture.expected.initial_tier
      && record.selected_tier === fixture.expected.selected_tier
      && Boolean(record.tier_override) === Boolean(fixture.expected.override_applied);
    return { id: fixture.id, file: name, expected: fixture.expected, actual: { initial_tier: record.initial_decision.tier, selected_tier: record.selected_tier, override_applied: Boolean(record.tier_override) }, status: pass ? 'PASS' : 'FAIL' };
  } catch (error) {
    return { id: fixture.id, file: name, status: 'FAIL', error: error.message };
  }
});
const passed = results.filter((result) => result.status === 'PASS').length;
fs.mkdirSync(reportDir, { recursive: true });
const jsonPath = path.join(reportDir, `tier-routing-test-report-${date}.json`);
const mdPath = path.join(reportDir, `tier-routing-test-report-${date}.md`);
fs.writeFileSync(jsonPath, JSON.stringify({ phase: 3, generated_at: new Date().toISOString(), total: results.length, passed, failed: results.length - passed, results }, null, 2), 'utf8');
const lines = ['# Phase 3 — Tier Routing Test Report', '', `**Date:** ${date}  `, `**Result:** ${passed}/${results.length} passed`, '', '| Fixture | Expected | Actual | Status |', '|---|---|---|---|'];
for (const result of results) lines.push(`| ${result.id} | ${result.expected ? `T${result.expected.initial_tier} → T${result.expected.selected_tier}` : '—'} | ${result.actual ? `T${result.actual.initial_tier} → T${result.actual.selected_tier}` : result.error} | ${result.status} |`);
fs.writeFileSync(mdPath, lines.join('\n') + '\n', 'utf8');
console.log(`Phase 3 routing tests: ${passed}/${results.length} passed`);
console.log(`Report: ${mdPath}`);
process.exit(passed === results.length ? 0 : 1);
