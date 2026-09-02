/**
 * Architecture Skill — Tier Routing
 * Phase 3 implementation (GAP-010)
 *
 * Selects an initial Tier 1/2/3 architecture depth from a Phase 2 PRD index
 * and, when provided, explicit PRD-grounded routing signals. A human override
 * is accepted only with a material reason and source evidence.
 *
 * Usage:
 *   node phase3/tier-routing.js --index <prd-index.json> [--context <routing-context.json>] [--override <override.json>] [--out <report.json>]
 *   node phase3/tier-routing.js --input <routing-input.json> [--override <override.json>] [--out <report.json>]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VALID_TIERS = new Set([1, 2, 3]);

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read JSON file ${filePath}: ${error.message}`);
  }
}

function getSkillVersion() {
  const manifestPath = path.resolve(__dirname, '..', 'skill-manifest.json');
  try {
    return readJson(manifestPath).skill_version || 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

function numberOr(value, fallback = 0) {
  return Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;
}

function bool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function deriveSignals(input) {
  const metadata = input.metadata || {};
  const supplied = input.signals || {};
  const requirements = Array.isArray(input.requirements) ? input.requirements : [];

  const explicitFromRequirements = requirements.filter((item) => item && item.explicit_id).length;
  const integrationRequirements = requirements.filter((item) => item && item.type === 'integration').length;
  const titles = requirements.map((item) => `${item.title || ''} ${item.module || ''}`).join(' ');

  const significantRequirementCount = numberOr(
    supplied.significant_requirement_count,
    numberOr(metadata.explicit_id_count, explicitFromRequirements || numberOr(metadata.requirement_count))
  );

  return {
    significant_requirement_count: significantRequirementCount,
    module_count: numberOr(supplied.module_count),
    integration_count: numberOr(supplied.integration_count),
    has_migration: supplied.has_migration === undefined ? /\bmigrat/i.test(titles) : bool(supplied.has_migration),
    has_multi_actor_access: supplied.has_multi_actor_access === undefined ? false : bool(supplied.has_multi_actor_access),
    has_material_lifecycle: supplied.has_material_lifecycle === undefined ? false : bool(supplied.has_material_lifecycle),
    has_reporting_or_deployment_constraints: supplied.has_reporting_or_deployment_constraints === undefined
      ? false
      : bool(supplied.has_reporting_or_deployment_constraints),
    mode: supplied.mode || input.mode || 'unspecified',
    evidence: {
      significant_requirement_count: supplied.evidence?.significant_requirement_count
        || (metadata.explicit_id_count !== undefined
          ? `Phase 2 index metadata.explicit_id_count = ${metadata.explicit_id_count}`
          : 'Derived from supplied routing input.'),
      module_count: supplied.evidence?.module_count || (supplied.module_count !== undefined ? 'Supplied PRD module count.' : 'Not supplied; treated as 0.'),
      integration_count: supplied.evidence?.integration_count || (supplied.integration_count !== undefined ? 'Supplied PRD integration count.' : `Not inferred from ${integrationRequirements} integration-tagged requirement(s).`),
      migration: supplied.evidence?.migration || (supplied.has_migration !== undefined ? 'Supplied PRD migration evidence.' : (titles ? 'Keyword scan of Phase 2 index requirements.' : 'No index text available.')),
      multi_actor_access: supplied.evidence?.multi_actor_access || (supplied.has_multi_actor_access !== undefined ? 'Supplied PRD actor/access evidence.' : 'Not supplied; treated as false.'),
      lifecycle: supplied.evidence?.lifecycle || (supplied.has_material_lifecycle !== undefined ? 'Supplied PRD lifecycle evidence.' : 'Not supplied; treated as false.'),
      reporting_or_deployment: supplied.evidence?.reporting_or_deployment || (supplied.has_reporting_or_deployment_constraints !== undefined ? 'Supplied PRD reporting/deployment evidence.' : 'Not supplied; treated as false.'),
    },
  };
}

function selectInitialTier(signals) {
  const reasons = [];
  if (signals.module_count >= 6) reasons.push(`module_count ${signals.module_count} is at least 6`);
  if (signals.significant_requirement_count >= 40) reasons.push(`significant_requirement_count ${signals.significant_requirement_count} is at least 40`);
  if (signals.has_migration && signals.integration_count >= 2) reasons.push('migration is present with at least 2 integrations');
  if (signals.has_multi_actor_access && (signals.has_material_lifecycle || signals.has_reporting_or_deployment_constraints)) {
    reasons.push('multi-actor access is present with a material lifecycle, reporting, or deployment constraint');
  }
  if (reasons.length) return { tier: 3, reasons };

  if (signals.significant_requirement_count >= 11 && signals.significant_requirement_count <= 39) {
    reasons.push(`significant_requirement_count ${signals.significant_requirement_count} is between 11 and 39`);
  }
  if (signals.module_count >= 2 && signals.module_count <= 5) reasons.push(`module_count ${signals.module_count} is between 2 and 5`);
  if (signals.module_count === 1 && (signals.integration_count >= 1 || signals.has_material_lifecycle || signals.has_multi_actor_access)) {
    reasons.push('one material module has an integration, lifecycle, or security/access boundary');
  }
  if (reasons.length) return { tier: 2, reasons };

  return { tier: 1, reasons: ['No Tier 2 or Tier 3 routing condition is met.'] };
}

function validateOverride(override, initialTier) {
  if (!override) return { applied: false, record: null };
  const selectedTier = Number(override.selected_tier);
  if (!VALID_TIERS.has(selectedTier)) throw new Error('Override selected_tier must be 1, 2, or 3.');
  if (selectedTier === initialTier) throw new Error('Override selected_tier must differ from the initial tier.');
  const reason = String(override.reason || '').trim();
  if (reason.length < 20) throw new Error('Override reason must be at least 20 characters and explain the material architectural weight.');
  if (/\b(longer|length|pad|more detail)\b/i.test(reason)) throw new Error('Override reason cannot be based on document length or padding.');
  const evidence = Array.isArray(override.source_evidence) ? override.source_evidence.filter(Boolean) : [];
  if (evidence.length === 0) throw new Error('Override source_evidence must contain at least one PRD locator or evidence reference.');
  return {
    applied: true,
    record: {
      initial_tier: initialTier,
      selected_tier: selectedTier,
      reason,
      source_evidence: evidence,
      approver: override.approver || 'not_required',
    },
  };
}

function buildRoutingRecord(input, override) {
  const signals = deriveSignals(input);
  const initial = selectInitialTier(signals);
  const overrideResult = validateOverride(override, initial.tier);
  return {
    record_type: 'tier_routing',
    schema_version: 'phase3-v1',
    generated_at: new Date().toISOString(),
    skill_version: getSkillVersion(),
    source_index: input.metadata?.prd_path || input.source_index || 'routing fixture or direct input',
    source_hash: input.metadata?.prd_sha256 || input.source_hash || 'not_available',
    signals,
    initial_decision: {
      tier: initial.tier,
      reasons: initial.reasons,
    },
    tier_override: overrideResult.record,
    selected_tier: overrideResult.applied ? overrideResult.record.selected_tier : initial.tier,
    decision_status: overrideResult.applied ? 'approved_override_required' : 'deterministic_selection',
  };
}

function parseArgs(args) {
  const value = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : null;
  };
  return { index: value('--index'), input: value('--input'), context: value('--context'), override: value('--override'), out: value('--out') };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.index && !options.input) {
    console.error('Usage: node phase3/tier-routing.js --index <prd-index.json> [--context <routing-context.json>] [--override <override.json>] [--out <report.json>]');
    console.error('   or: node phase3/tier-routing.js --input <routing-input.json> [--override <override.json>] [--out <report.json>]');
    process.exit(2);
  }
  try {
    const inputPath = path.resolve(options.index || options.input);
    const input = readJson(inputPath);
    if (options.context) input.signals = { ...(input.signals || {}), ...readJson(path.resolve(options.context)).signals };
    const inlineOverride = input.override;
    const override = options.override ? readJson(path.resolve(options.override)) : inlineOverride;
    const record = buildRoutingRecord(input, override);
    const outPath = options.out
      ? path.resolve(options.out)
      : path.resolve(__dirname, 'reports', `tier-selection-${new Date().toISOString().slice(0, 10)}.json`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(record, null, 2), 'utf8');
    console.log(`Initial tier: ${record.initial_decision.tier}`);
    console.log(`Selected tier: ${record.selected_tier}`);
    console.log(`Override: ${record.tier_override ? 'recorded' : 'none'}`);
    console.log(`Report: ${outPath}`);
  } catch (error) {
    console.error(`Tier routing failed: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { buildRoutingRecord, deriveSignals, selectInitialTier, validateOverride };
