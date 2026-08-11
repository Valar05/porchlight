import fs from 'node:fs';
import path from 'node:path';
import {loadMap, freshnessPlan} from './map.mjs';
const root = path.resolve(process.argv[2] || path.dirname(new URL(import.meta.url).pathname));
const index = loadMap(root);
const packs = index.sites.map((s) => JSON.parse(fs.readFileSync(path.join(root, 'site-packs', s.site, 'adapter.json'))));
const due = freshnessPlan(packs);
process.stdout.write(JSON.stringify({checkedAt: new Date().toISOString(), due}, null, 2) + '\n');
if (due.length) process.exitCode = 2;
