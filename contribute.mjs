import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {sha256} from './core.mjs';

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function buildSitePack({site, origin, evidence, adapter = {}}) {
  if (!SLUG.test(site)) throw new Error('INVALID_SITE_SLUG');
  const publicOrigin = new URL(origin).origin;
  if (!/^https:$/.test(new URL(publicOrigin).protocol)) throw new Error('PUBLIC_HTTPS_ORIGIN_REQUIRED');
  const rows = (evidence || []).filter((x) => x.postconditionVerified && x.successes >= 3).map((x) => ({
    pageArchetype: String(x.pageArchetype || 'unknown'),
    action: String(x.action),
    task: String(x.task || ''),
    accessibleName: sanitizePublicLabel(x.accessibleName),
    role: String(x.role || ''),
    locatorStrategy: String(x.locatorStrategy),
    selectorHint: sanitizeSelector(x.selectorHint),
    expectedPostcondition: String(x.expectedPostcondition || ''),
    accessibilityFailure: String(x.accessibilityFailure || ''),
    authRequired: Boolean(x.authRequired),
    successes: Number(x.successes),
    failures: Number(x.failures || 0),
  }));
  const pack = {
    schema: 'porchlight.site-pack.v1',
    site,
    publicOrigin,
    originFingerprint: sha256(publicOrigin),
    generatedBy: 'porchlight-worker',
    observedAt: new Date().toISOString(),
    freshUntil: new Date(Date.now() + 30 * 86400_000).toISOString(),
    privacy: {rawDom: false, screenshots: false, fieldValues: false, accountIdentifiers: false, pathAndQuery: false, publicOrigin: true},
    adapter: {receiptClaims: adapter.receiptClaims || ['page_action_verified'], nativeRoutes: adapter.nativeRoutes || ['upload']},
    routes: rows.sort((a, b) => `${a.pageArchetype}:${a.task}:${a.action}`.localeCompare(`${b.pageArchetype}:${b.task}:${b.action}`)),
  };
  return pack;
}

export function validateSitePack(pack) {
  if (pack?.schema !== 'porchlight.site-pack.v1' || !SLUG.test(pack?.site || '')) throw new Error('INVALID_PACK');
  const serialized = JSON.stringify(pack);
  if (/\?(?:[^" ]+)|https?:\/\/[^/" ]+\/[^" ]+|@/.test(serialized) || /screenshotData|cookie/i.test(serialized)) throw new Error('PRIVACY_LEAK');
  if (!pack.routes.every((x) => x.successes >= 3 && x.pageArchetype && x.action && x.expectedPostcondition)) throw new Error('UNGRADUATED_EVIDENCE');
  return true;
}

export function writeContribution({root, pack}) {
  validateSitePack(pack);
  const dir = path.join(root, 'site-packs', pack.site);
  fs.mkdirSync(path.join(dir, 'fixtures'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'adapter.json'), JSON.stringify(pack, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'adapter.test.mjs'), testSource(pack.site));
  return dir;
}

export function openContributionPr({root, site, base = 'main', mode = 'approval', repo}) {
  if (mode === 'local-only') return {status: 'local_only'};
  if (mode === 'approval') return {status: 'approval_required', exactAction: `publish sanitized ${site} site pack to ${repo}`};
  if (mode !== 'automatic') throw new Error('INVALID_CONTRIBUTION_MODE');
  const branch = `porchlight/site-pack-${site}-${Date.now()}`;
  run('git', ['checkout', '-b', branch], root);
  run('git', ['add', `site-packs/${site}`], root);
  run('git', ['commit', '-m', `Add verified Porchlight site pack for ${site}`], root);
  run('git', ['push', '-u', 'origin', branch], root);
  const result = run('gh', ['pr', 'create', '--repo', repo, '--base', base, '--head', branch, '--title', `Porchlight site pack: ${site}`, '--body', 'Deterministically generated from at least three verified successes. Privacy checks exclude raw DOM, field values, screenshots, account identifiers, and URL paths/query strings.'], root);
  return {status: 'opened', branch, output: result.stdout.trim()};
}

function sanitizeSelector(input) {
  const value = String(input || '');
  if (!value) return '';
  if (/https?:|@|\b\d{5,}\b|\[value=|cookie/i.test(value)) throw new Error('UNSAFE_SELECTOR_HINT');
  return value.slice(0, 300);
}
function sanitizePublicLabel(input) {
  const value = String(input || '').replace(/\s+/g, ' ').trim();
  if (/@|\b\d{5,}\b|https?:|account|claim\s*#?/i.test(value)) return '';
  return value.slice(0, 160);
}
function run(bin, args, cwd) { const result = spawnSync(bin, args, {cwd, encoding: 'utf8'}); if (result.status !== 0) throw new Error(`${bin} failed: ${result.stderr}`); return result; }
function testSource(site) { return `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\nconst pack = JSON.parse(fs.readFileSync(new URL('./adapter.json', import.meta.url)));\ntest('${site} pack exposes only a public origin', () => { const text = JSON.stringify(pack); assert.equal(/https?:\\/\\/[^/\\\"]+\\/[^\\\"]+|@/.test(text), false); assert.equal(pack.privacy.rawDom, false); assert.ok(pack.routes.every(x => x.successes >= 3)); });\n`; }
