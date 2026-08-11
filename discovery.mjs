import fs from 'node:fs';
import path from 'node:path';
import {buildSitePack, openContributionPr, writeContribution} from './contribute.mjs';
import {sha256} from './core.mjs';

export class DiscoveryWorker {
  constructor({dataDir, checkoutRoot, repo = '', mode = 'local-only', clock = () => Date.now()}) {
    this.file = path.join(dataDir, 'discoveries.json');
    this.checkoutRoot = checkoutRoot;
    this.repo = repo;
    this.mode = mode;
    this.clock = clock;
    this.state = read(this.file, {version: 1, sites: {}});
  }
  record({origin, documentId, command, result, observation}) {
    if (!result?.verified || !command?.action) return {status: 'ignored', reason: 'unverified'};
    const publicOrigin = new URL(origin).origin;
    const site = slug(new URL(publicOrigin).hostname);
    const archetype = classify(observation || result.after || {});
    const label = publicLabel(command.target?.name);
    const key = sha256(JSON.stringify({publicOrigin, archetype, action: command.action, task: label.toLowerCase()}));
    const bucket = this.state.sites[site] ||= {publicOrigin, evidence: {}};
    const row = bucket.evidence[key] ||= {pageArchetype: archetype, action: command.action, task: label || command.action, accessibleName: label, role: result.role || '', locatorStrategy: result.locatorStrategy || '', selectorHint: result.selectorHint || '', expectedPostcondition: expected(command.action), accessibilityFailure: result.accessibilityFailure || '', authRequired: Boolean(result.authRequired), successes: 0, failures: 0, documents: []};
    const doc = sha256(documentId || 'unknown');
    if (!row.documents.includes(doc)) row.documents.push(doc);
    row.successes += 1; row.lastVerifiedAt = new Date(this.clock()).toISOString();
    atomic(this.file, this.state);
    return row.successes >= 3 && row.documents.length >= 2 ? {status: 'graduated', site, pack: this.pack(site)} : {status: 'learning', site, successes: row.successes, distinctDocuments: row.documents.length};
  }
  failure({origin, command}) {
    const site = slug(new URL(origin).hostname); const bucket = this.state.sites[site]; if (!bucket) return;
    for (const row of Object.values(bucket.evidence)) if (row.action === command.action && row.accessibleName === publicLabel(command.target?.name)) row.failures += 1;
    atomic(this.file, this.state);
  }
  pack(site) {
    const bucket = this.state.sites[site]; if (!bucket) throw new Error('SITE_UNKNOWN');
    return buildSitePack({site, origin: bucket.publicOrigin, evidence: Object.values(bucket.evidence).map(({documents, ...row}) => ({...row, postconditionVerified: row.successes >= 3 && documents.length >= 2}))});
  }
  publish(site) {
    const pack = this.pack(site);
    writeContribution({root: this.checkoutRoot, pack});
    const result = openContributionPr({root: this.checkoutRoot, site, repo: this.repo, mode: this.mode});
    if (result.status === 'opened') { this.state.sites[site].lastPublishedHash = sha256(JSON.stringify(pack)); this.state.sites[site].lastPublishedAt = new Date(this.clock()).toISOString(); atomic(this.file, this.state); }
    return result;
  }
}

function classify(observation) {
  const hay = `${observation.title || ''} ${(observation.elements || []).map((x) => `${x.role} ${x.name}`).join(' ')}`.toLowerCase();
  const rules = [['sign-in', /sign in|log in|password/], ['checkout', /checkout|payment|order total/], ['claim-overview', /claim|benefit|coverage/], ['messages', /inbox|message|compose/], ['documents', /document|upload|attachment/], ['search-results', /search results|filter results/], ['account-settings', /account settings|profile|preferences/]];
  return rules.find(([, re]) => re.test(hay))?.[0] || 'application-page';
}
function expected(action) { return ({click: 'target state, URL, title, or semantic fingerprint changes', set_value: 'field value hash matches on readback', select: 'selected option matches on readback', scroll: 'scroll position changes or page is already fully visible', submit: 'page action is verified; remote receipt remains separately unconfirmed', send: 'page action is verified; remote delivery remains separately unconfirmed', file: 'page action is verified; remote filing remains separately unconfirmed', read: 'target remains uniquely resolvable', find: 'target remains uniquely resolvable'}[action] || 'fresh semantic observation is returned'); }
function publicLabel(value) { const x = String(value || '').replace(/\s+/g, ' ').trim(); return /@|\b\d{5,}\b|https?:|claim\s*#?|account\s*#?/i.test(x) ? '' : x.slice(0, 160); }
function slug(host) { return host.toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 63); }
function read(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function atomic(file, value) { fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700}); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2), {mode: 0o600}); fs.renameSync(tmp, file); }
