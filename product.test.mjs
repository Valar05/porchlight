import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {parsePrompt, screenshotPolicy, stageApproval, consumeApproval, safeEvent, summarize, receiptSemantics, MOTIVATED_MODE} from './core.mjs';
import {buildSitePack, validateSitePack} from './contribute.mjs';
import {DiscoveryWorker} from './discovery.mjs';
import {loadMap, queryMap, freshnessPlan, renderAccessibleHtml} from './map.mjs';
import {createRuntime} from './daemon.mjs';
import {PORCHLIGHT_EXTENSION_ID, PORCHLIGHT_EXTENSION_ORIGIN, PORCHLIGHT_EXTENSION_PUBLIC_KEY, chromeExtensionIdFromPublicKey} from './extension-identity.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'porchlight-test-'));
const binding = {pairingId: 'pair-1', tabId: 7, documentId: 'doc-1', origin: 'https://portal.example'};

test('chat grammar is fixed and does not guess', () => {
  assert.deepEqual(parsePrompt('click “Documents”'), {kind: 'command', action: 'click', target: {name: 'Documents'}});
  assert.equal(parsePrompt('solve this portal').kind, 'unknown');
});

test('typed values are parsed but never placed in safe events', () => {
  const parsed = parsePrompt('type “secret 123” into “Search”');
  const event = safeEvent({type: 'command_completed', action: parsed.action, value: parsed.value, targetName: parsed.target.name});
  assert.equal(JSON.stringify(event).includes('secret 123'), false);
  assert.match(event.valueHash, /^[a-f0-9]{64}$/);
});

test('commit actions require an exact one-use digest bound to tab and document', () => {
  const staged = stageApproval({action: 'submit', target: {name: 'Submit appeal'}}, binding, 1000);
  assert.throws(() => consumeApproval(staged, '0'.repeat(64), binding, 1001), /MISMATCH/);
  const approved = consumeApproval(staged, staged.digest, binding, 1001);
  assert.equal(approved.action, 'submit');
  assert.throws(() => consumeApproval(staged, staged.digest, binding, 1002), /UNKNOWN/);
});

test('approval cannot cross a document boundary', () => {
  const staged = stageApproval({action: 'send', target: {name: 'Send'}}, binding, 1000);
  assert.throws(() => consumeApproval(staged, staged.digest, {...binding, documentId: 'doc-2'}, 1001), /SCOPE/);
});

test('screenshots are exceptional and rate limited', () => {
  assert.equal(screenshotPolicy({misses: 1, nowMs: 20_000}).capture, false);
  assert.deepEqual(screenshotPolicy({misses: 2, nowMs: 20_000}), {capture: true, reason: 'target_failed_twice'});
  assert.equal(screenshotPolicy({sparse: true, lastCaptureMs: 19_000, nowMs: 20_000}).capture, false);
  assert.equal(screenshotPolicy({explicit: true, lastCaptureMs: 19_999, nowMs: 20_000}).capture, true);
});

test('metrics answer whether the worker is helping without model telemetry', () => {
  const events = [safeEvent({type: 'command_completed', action: 'click', outcome: 'verified', durationMs: 40}), safeEvent({type: 'command_completed', action: 'click', outcome: 'TARGET_NOT_FOUND', durationMs: 80}), safeEvent({type: 'command_completed', action: 'screenshot', outcome: 'verified', durationMs: 50})];
  assert.deepEqual(summarize(events), {commands: 3, verified: 2, verificationRate: 2 / 3, failures: 1, screenshots: 1, medianLatencyMs: 50, modelCalls: 0, networkInferenceCalls: 0});
});

test('Motivated Mode is central, permanent, bounded, and does not expand authority', () => {
  assert.deepEqual(MOTIVATED_MODE, {status: 'central_permanent', ownOutcome: true, obviousAdjacentImprovement: true, boundedRecovery: true, authorityExpansion: false});
  assert.equal(safeEvent({type: 'test'}).motivatedMode, 'central_permanent');
});

test('page submission never becomes remote receipt without remote evidence', () => {
  const adapter = {receiptClaims: ['page_action_verified', 'remote_received']};
  assert.equal(receiptSemantics(adapter, {claim: 'page_action_verified'}).state, 'page_action_verified');
  assert.equal(receiptSemantics(adapter, {claim: 'remote_received'}).state, 'submitted_unconfirmed');
  assert.equal(receiptSemantics(adapter, {claim: 'remote_received', remoteEvidence: {confirmationId: 'ABC'}}).state, 'received_confirmed');
});

test('site packs expose public origin but not paths, queries, accounts, DOM, or screenshots', () => {
  const pack = buildSitePack({site: 'example-com', origin: 'https://example.com/private?id=7', evidence: [{pageArchetype: 'documents', action: 'click', task: 'view documents', accessibleName: 'Documents', role: 'button', locatorStrategy: 'accessible_name', selectorHint: '[data-testid=documents]', expectedPostcondition: 'documents region appears', successes: 3, failures: 0, postconditionVerified: true}]});
  assert.equal(pack.publicOrigin, 'https://example.com');
  assert.equal(JSON.stringify(pack).includes('/private'), false);
  assert.equal(validateSitePack(pack), true);
});

test('unsafe public labels and selectors are stripped or rejected', () => {
  const pack = buildSitePack({site: 'example-com', origin: 'https://example.com', evidence: [{pageArchetype: 'account', action: 'click', task: 'open', accessibleName: 'Claim #19284100', role: 'button', locatorStrategy: 'accessible_name', selectorHint: '', expectedPostcondition: 'panel appears', successes: 3, postconditionVerified: true}]});
  assert.equal(pack.routes[0].accessibleName, '');
  assert.throws(() => buildSitePack({site: 'bad-pack', origin: 'https://example.com', evidence: [{pageArchetype: 'x', action: 'click', selectorHint: '[value=user@example.com]', expectedPostcondition: 'x', successes: 3, postconditionVerified: true}]}), /UNSAFE/);
});

test('discovery needs three successes across two documents before graduation', () => {
  const dir = temp();
  const worker = new DiscoveryWorker({dataDir: dir, checkoutRoot: dir, clock: () => 1000});
  const row = (documentId) => worker.record({origin: 'https://example.com/account/secret', documentId, command: {action: 'click', target: {name: 'Documents'}}, result: {verified: true, locatorStrategy: 'accessible_name'}, observation: {title: 'Documents'}});
  assert.equal(row('doc-a').status, 'learning');
  assert.equal(row('doc-a').status, 'learning');
  assert.equal(row('doc-b').status, 'graduated');
  fs.rmSync(dir, {recursive: true, force: true});
});

test('map loader, query, accessible HTML, and freshness planner operate on site packs', () => {
  const root = path.dirname(new URL(import.meta.url).pathname);
  const index = loadMap(root);
  assert.ok(index.sites.some((x) => x.site === 'lincoln-example'));
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'site-packs/lincoln-example/adapter.json')));
  assert.equal(queryMap([fixture], {task: 'documents'})[0].pageArchetype, 'claim-overview');
  assert.match(renderAccessibleHtml(index), /<main><h1>Porchlight Internet Access Map/);
  assert.equal(freshnessPlan([fixture], Date.parse('2098-01-01')).length, 0);
});

test('runtime queues real commands, records verified receipts, and feeds map learning', () => {
  const dir = temp(); let now = 10_000;
  const runtime = createRuntime({dataDir: dir, clock: () => now});
  runtime.state.pairing = {...binding, windowId: 1};
  const queued = runtime.prompt('click “Documents”');
  now += 25;
  const done = runtime.complete({pairingId: binding.pairingId, commandId: queued.commandId, result: {verified: true, locatorStrategy: 'accessible_name', after: {title: 'Documents'}}});
  assert.equal(done.receipt.outcome, 'verified');
  assert.equal(done.mapLearning.status, 'learning');
  assert.equal(fs.readFileSync(path.join(dir, 'receipts.jsonl'), 'utf8').includes('Documents'), false);
  fs.rmSync(dir, {recursive: true, force: true});
});

test('runtime automatically requests one sparse-DOM screenshot and stores no pixels', () => {
  const dir = temp(); let now = 20_000; const runtime = createRuntime({dataDir: dir, clock: () => now});
  runtime.state.pairing = {...binding, windowId: 1, expiresAtMs: 999_999};
  const queued = runtime.prompt('look'); now += 10;
  const done = runtime.complete({pairingId: binding.pairingId, commandId: queued.commandId, result: {verified: true, locatorStrategy: 'semantic_inventory', observation: {elements: [], bodyTextLength: 20}}});
  assert.equal(done.fallback.action, 'screenshot'); assert.equal(done.fallback.reason, 'dom_sparse');
  const shot = runtime.state.pending[0]; now += 10;
  runtime.complete({pairingId: binding.pairingId, commandId: shot.commandId, result: {verified: true, screenshotDataUrl: 'data:image/png;base64,PRIVATEPIXELS', screenshotReason: 'dom_sparse'}});
  assert.equal(fs.readFileSync(path.join(dir, 'receipts.jsonl'), 'utf8').includes('PRIVATEPIXELS'), false);
  fs.rmSync(dir, {recursive: true, force: true});
});

test('manifest public key deterministically pins the Porchlight extension origin', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'extension/manifest.json')));
  assert.equal(manifest.key, PORCHLIGHT_EXTENSION_PUBLIC_KEY);
  assert.equal(chromeExtensionIdFromPublicKey(manifest.key), PORCHLIGHT_EXTENSION_ID);
  assert.equal(PORCHLIGHT_EXTENSION_ORIGIN, 'chrome-extension://dmfjnjkccebgbiepjbmbdmpffcaikaje');
});

test('loopback relay performs gesture pairing, command delivery, completion, CORS, and revoke', async () => {
  const dir = temp(); const runtime = createRuntime({dataDir: dir, port: 0}); await runtime.listen();
  const base = `http://127.0.0.1:${runtime.server.address().port}`; const origin = PORCHLIGHT_EXTENSION_ORIGIN; const wrongOrigin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const pairingReady = runtime.prompt('pair https://example.com/private');
  assert.equal(pairingReady.expectedOrigin, 'https://example.com');
  const wrongPreflight = await fetch(`${base}/v1/pair`, {method: 'OPTIONS', headers: {origin: wrongOrigin}});
  assert.equal(wrongPreflight.status, 400);
  const wrongIntent = await fetch(`${base}/v1/pair-intent`, {headers: {origin: wrongOrigin}});
  assert.equal(wrongIntent.status, 400);
  const preflight = await fetch(`${base}/v1/pair`, {method: 'OPTIONS', headers: {origin}});
  assert.equal(preflight.status, 204);
  const intentResponse = await fetch(`${base}/v1/pair-intent`, {headers: {origin}}); const intent = await intentResponse.json();
  const wrongPair = await fetch(`${base}/v1/pair`, {method: 'POST', headers: {origin: wrongOrigin, 'content-type': 'application/json'}, body: JSON.stringify({token: intent.token, url: 'https://example.com/private?id=1', tabId: 99, windowId: 99, documentId: 'hostile-doc'})});
  assert.equal(wrongPair.status, 400);
  const pairResponse = await fetch(`${base}/v1/pair`, {method: 'POST', headers: {origin, 'content-type': 'application/json'}, body: JSON.stringify({token: intent.token, url: 'https://example.com/private?id=1', tabId: 2, windowId: 1, documentId: 'doc-1'})});
  assert.equal(pairResponse.status, 201); const {pairing} = await pairResponse.json();
  const queued = runtime.prompt('look');
  const wrongCommand = await fetch(`${base}/v1/command?pairingId=${pairing.pairingId}`, {headers: {origin: wrongOrigin}});
  assert.equal(wrongCommand.status, 400);
  const wrongComplete = await fetch(`${base}/v1/complete`, {method: 'POST', headers: {origin: wrongOrigin, 'content-type': 'application/json'}, body: JSON.stringify({pairingId: pairing.pairingId, commandId: queued.commandId, result: {verified: true}})});
  assert.equal(wrongComplete.status, 400);
  const wrongRevoke = await fetch(`${base}/v1/revoke`, {method: 'POST', headers: {origin: wrongOrigin, 'content-type': 'application/json'}, body: JSON.stringify({pairingId: pairing.pairingId})});
  assert.equal(wrongRevoke.status, 400);
  const commandResponse = await fetch(`${base}/v1/command?pairingId=${pairing.pairingId}`, {headers: {origin}});
  assert.equal((await commandResponse.json()).command.commandId, queued.commandId);
  const completeResponse = await fetch(`${base}/v1/complete`, {method: 'POST', headers: {origin, 'content-type': 'application/json'}, body: JSON.stringify({pairingId: pairing.pairingId, commandId: queued.commandId, result: {verified: true, locatorStrategy: 'semantic_inventory'}})});
  assert.equal(completeResponse.status, 200);
  const revokeResponse = await fetch(`${base}/v1/revoke`, {method: 'POST', headers: {origin, 'content-type': 'application/json'}, body: JSON.stringify({pairingId: pairing.pairingId})});
  assert.equal(revokeResponse.status, 200); assert.equal(runtime.state.pairing, null);
  await runtime.close(); fs.rmSync(dir, {recursive: true, force: true});
});

test('native upload is routed instead of faked as a DOM success', () => assert.equal(createRuntime({dataDir: temp()}).prompt('upload appeal').status, 'route_native'));
