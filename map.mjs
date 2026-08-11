import fs from 'node:fs';
import path from 'node:path';
import {validateSitePack} from './contribute.mjs';

export function loadMap(root) {
  const base = path.join(root, 'site-packs');
  const packs = [];
  if (!fs.existsSync(base)) return {schema: 'porchlight.map-index.v1', generatedAt: new Date().toISOString(), sites: []};
  for (const name of fs.readdirSync(base).sort()) {
    const file = path.join(base, name, 'adapter.json');
    if (!fs.existsSync(file)) continue;
    const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
    validateSitePack(pack); packs.push(pack);
  }
  return {schema: 'porchlight.map-index.v1', generatedAt: new Date().toISOString(), sites: packs.map((p) => ({site: p.site, publicOrigin: p.publicOrigin, observedAt: p.observedAt, freshUntil: p.freshUntil, routeCount: p.routes.length, pageArchetypes: [...new Set(p.routes.map((r) => r.pageArchetype))].sort()}))};
}

export function queryMap(packs, {origin, task, archetype} = {}) {
  const needle = String(task || '').toLowerCase();
  return packs.filter((p) => !origin || p.publicOrigin === new URL(origin).origin).flatMap((p) => p.routes.filter((r) => (!archetype || r.pageArchetype === archetype) && (!needle || `${r.task} ${r.accessibleName} ${r.action}`.toLowerCase().includes(needle))).map((r) => ({site: p.site, publicOrigin: p.publicOrigin, observedAt: p.observedAt, fresh: Date.parse(p.freshUntil) > Date.now(), ...r})));
}

export function freshnessPlan(packs, nowMs = Date.now()) {
  return packs.map((p) => ({site: p.site, publicOrigin: p.publicOrigin, due: Date.parse(p.freshUntil) <= nowMs, daysOld: Math.floor((nowMs - Date.parse(p.observedAt)) / 86400_000), mode: p.routes.some((r) => r.authRequired) ? 'human_worker' : 'public_probe'})).filter((x) => x.due).sort((a, b) => b.daysOld - a.daysOld);
}

export function renderAccessibleHtml(index) {
  const rows = index.sites.map((s) => `<li><a href="${escape(s.publicOrigin)}">${escape(s.site)}</a>: ${s.routeCount} mapped task routes; page types ${s.pageArchetypes.map(escape).join(', ') || 'unknown'}; observed <time>${escape(s.observedAt)}</time></li>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Porchlight Internet Access Map</title><main><h1>Porchlight Internet Access Map</h1><p>A community-maintained map of how people and assistive tools can navigate the web.</p><label for="q">Filter mapped sites</label> <input id="q" type="search"><p id="count" role="status" aria-live="polite"></p><ul id="sites">${rows}</ul></main><script>const q=document.getElementById('q'),sites=document.getElementById('sites'),count=document.getElementById('count');function filter(){let n=0;for(const x of sites.children){x.hidden=!x.textContent.toLowerCase().includes(q.value.toLowerCase());if(!x.hidden)n++}count.textContent=n+' mapped sites shown'}q.addEventListener('input',filter);filter()</script></html>`;
}
const escape = (v) => String(v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
