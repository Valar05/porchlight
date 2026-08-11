#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {loadMap, queryMap, freshnessPlan} from './map.mjs';

const root = path.resolve(process.env.PORCHLIGHT_MAP_ROOT || path.dirname(new URL(import.meta.url).pathname));
const command = process.argv[2] || 'sites';
const index = loadMap(root);
const packs = index.sites.map((s) => JSON.parse(fs.readFileSync(path.join(root, 'site-packs', s.site, 'adapter.json'))));
if (command === 'sites') process.stdout.write(JSON.stringify(index, null, 2) + '\n');
else if (command === 'query') process.stdout.write(JSON.stringify(queryMap(packs, {origin: process.argv[3], task: process.argv.slice(4).join(' ')}), null, 2) + '\n');
else if (command === 'stale') process.stdout.write(JSON.stringify(freshnessPlan(packs), null, 2) + '\n');
else { process.stderr.write('Usage: porchlight-map sites | query ORIGIN TASK | stale\n'); process.exitCode = 2; }
