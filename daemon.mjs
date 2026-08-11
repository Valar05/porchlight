import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes, randomUUID} from 'node:crypto';
import {parsePrompt, safeEvent, screenshotPolicy, stageApproval, consumeApproval, summarize, receiptSemantics, sha256} from './core.mjs';
import {DiscoveryWorker} from './discovery.mjs';
import {PORCHLIGHT_EXTENSION_ORIGIN} from './extension-identity.mjs';

export function createRuntime({host = '127.0.0.1', port = 9235, dataDir = path.resolve('.porchlight'), capability = randomBytes(32).toString('hex'), clock = () => Date.now(), checkoutRoot = process.cwd(), contributionRepo = '', contributionMode = 'local-only', expectedExtensionOrigin = PORCHLIGHT_EXTENSION_ORIGIN} = {}) {
  fs.mkdirSync(dataDir, {recursive: true, mode: 0o700});
  const logPath = path.join(dataDir, 'receipts.jsonl');
  const playbookPath = path.join(dataDir, 'playbooks.json');
  const state = {capability, intent: null, pairing: null, expectedExtensionOrigin, extensionOrigin: '', pending: [], completions: new Map(), approvals: new Map(), misses: new Map(), captures: new Map(), events: readEvents(logPath), playbooks: readJson(playbookPath, {version: 1, locators: {}})};
  const discovery = new DiscoveryWorker({dataDir, checkoutRoot, repo: contributionRepo, mode: contributionMode, clock});

  function append(input) {
    const event = safeEvent(input);
    fs.appendFileSync(logPath, JSON.stringify(event) + '\n', {encoding: 'utf8', mode: 0o600});
    state.events.push(event);
    return event;
  }
  function savePlaybooks() { atomicJson(playbookPath, state.playbooks); }
  function binding() { const p = state.pairing; return p && {pairingId: p.pairingId, tabId: p.tabId, documentId: p.documentId, origin: p.origin}; }
  function requirePairing() { if (!state.pairing) throw code('PAIRING_REQUIRED'); if (state.pairing.expiresAtMs <= clock()) { revoke('lease_expired'); throw code('PAIRING_EXPIRED'); } return state.pairing; }
  function stage(command) {
    const p = requirePairing();
    const row = stageApproval(command, binding(), clock());
    state.approvals.set(row.digest, row);
    append({type: 'approval_staged', action: command.action, origin: p.origin, documentId: p.documentId, targetName: command.target?.name});
    return {status: 'approval_required', digest: row.digest, expiresAtMs: row.expiresAtMs, exactAction: `${command.action} “${command.target.name}”`};
  }
  function queue(command) {
    const p = requirePairing();
    const row = {commandId: randomUUID(), pairingId: p.pairingId, issuedAtMs: clock(), ...command};
    state.pending.push(row);
    append({type: 'command_queued', action: row.action, origin: p.origin, documentId: p.documentId, targetName: row.target?.name, value: row.value});
    return {status: 'queued', commandId: row.commandId, action: row.action};
  }
  function prompt(text) {
    const parsed = parsePrompt(text);
    if (parsed.kind === 'pair') {
      state.intent = {pairingId: randomUUID(), token: randomBytes(18).toString('base64url'), expectedOrigin: parsed.origin, expiresAtMs: clock() + 120_000};
      return {status: 'pairing_ready', expectedOrigin: parsed.origin, expiresAtMs: state.intent.expiresAtMs, instruction: 'Open that site and click the Porchlight extension once.'};
    }
    if (parsed.kind === 'revoke') { revoke('user_request'); return {status: 'revoked'}; }
    if (parsed.kind === 'stats') return {status: 'ok', metrics: summarize(state.events)};
    if (parsed.kind === 'help') return {status: 'ok', commands: ['pair https://portal.example', 'look', 'click “Name”', 'read “Name”', 'type “value” into “Field”', 'choose “Option” in “Field”', 'scroll down', 'screenshot', 'submit “Button”', 'approve DIGEST', 'stats', 'revoke']};
    if (parsed.kind === 'unknown' || parsed.kind === 'native') return {status: parsed.kind === 'native' ? 'route_native' : 'not_understood', ...parsed};
    if (parsed.kind === 'stage_commit') return stage(parsed);
    if (parsed.kind === 'approve') {
      const approved = consumeApproval(state.approvals.get(parsed.digest), parsed.digest, binding(), clock());
      state.approvals.delete(parsed.digest);
      return queue(approved);
    }
    if (parsed.kind === 'command') return queue(parsed);
    return {status: 'not_understood'};
  }
  function revoke(reason) {
    if (state.pairing) append({type: 'pairing_revoked', outcome: reason, origin: state.pairing.origin, documentId: state.pairing.documentId});
    state.pairing = null; state.pending.length = 0; state.approvals.clear();
  }
  function complete(input) {
    const p = requirePairing();
    if (input.pairingId !== p.pairingId) throw code('PAIRING_MISMATCH');
    const command = state.pending.find((x) => x.commandId === input.commandId);
    if (!command) throw code('COMMAND_UNKNOWN');
    state.pending = state.pending.filter((x) => x.commandId !== input.commandId);
    const result = input.result || {};
    const event = append({type: 'command_completed', action: command.action, outcome: result.verified ? 'verified' : (result.code || 'unverified'), reason: result.reason, durationMs: clock() - command.issuedAtMs, retries: result.retries, locatorStrategy: result.locatorStrategy, origin: p.origin, documentId: p.documentId, targetName: command.target?.name, value: command.value, screenshotReason: result.screenshotReason, postconditionVerified: result.verified});
    if (result.verified && result.locatorStrategy && command.target?.name) {
      const key = `${sha256(p.origin)}:${command.action}:${sha256(command.target.name.toLowerCase())}`;
      const old = state.playbooks.locators[key] || {successes: 0, failures: 0};
      state.playbooks.locators[key] = {...old, successes: old.successes + 1, strategy: result.locatorStrategy, refHint: result.refHint || '', lastVerifiedAt: event.at};
      savePlaybooks();
    }
    const learning = result.verified
      ? discovery.record({origin: p.origin, documentId: p.documentId, command, result, observation: result.observation || result.after})
      : (discovery.failure({origin: p.origin, command}), {status: 'ignored', reason: 'unverified'});
    if (learning.status === 'graduated') {
      try { learning.publication = discovery.publish(learning.site); }
      catch (error) { learning.publication = {status: 'failed', error: error.message}; }
    }
    let missCount = 0;
    if (!result.verified && command.target?.name) {
      const key = `${p.documentId}:${command.action}:${command.target.name.toLowerCase()}`;
      missCount = (state.misses.get(key) || 0) + 1;
      state.misses.set(key, missCount);
    }
    const observation = result.observation || {};
    const fallback = command.action === 'screenshot' ? {capture: false, reason: ''} : screenshotPolicy({
      sparse: Array.isArray(observation.elements) && observation.elements.length === 0 && Number(observation.bodyTextLength || 0) < 80,
      visualSurface: Boolean(observation.visualSurface),
      misses: missCount,
      documentChanged: result.code === 'DOCUMENT_CHANGED',
      postconditionMismatch: result.reason === 'POSTCONDITION_MISMATCH',
      lastCaptureMs: state.captures.get(p.documentId) || 0,
      nowMs: clock(),
    });
    let fallbackCommand = null;
    if (fallback.capture) {
      state.captures.set(p.documentId, clock());
      fallbackCommand = queue({kind: 'command', action: 'screenshot', reason: fallback.reason});
    }
    state.completions.set(command.commandId, {result: scrubResult(result), receipt: event, mapLearning: learning, fallback: fallbackCommand ? {...fallbackCommand, reason: fallback.reason} : null});
    return state.completions.get(command.commandId);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${host}:${port}`);
      if (req.method === 'OPTIONS') {
        requireExtension(req, state.expectedExtensionOrigin);
        res.statusCode = 204; cors(res, state.expectedExtensionOrigin); return res.end();
      }
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, {ok: true, paired: Boolean(state.pairing), queued: state.pending.length, version: '0.8.1'});
      if (req.method === 'POST' && url.pathname === '/v1/prompt') { requireCapability(req, capability); return send(res, 200, prompt((await body(req)).prompt)); }
      if (req.method === 'GET' && url.pathname === '/v1/pair-intent') {
        requireExtension(req, state.expectedExtensionOrigin);
        if (!state.intent || state.intent.expiresAtMs <= clock()) return send(res, 404, {error: 'NO_PAIR_INTENT'}, state.expectedExtensionOrigin);
        return send(res, 200, state.intent, state.expectedExtensionOrigin);
      }
      if (req.method === 'POST' && url.pathname === '/v1/pair') {
        requireExtension(req, state.expectedExtensionOrigin);
        const input = await body(req); const intent = state.intent;
        if (!intent || intent.expiresAtMs <= clock() || input.token !== intent.token) throw code('PAIR_INTENT_INVALID');
        if (new URL(input.url).origin !== intent.expectedOrigin) throw code('ORIGIN_MISMATCH');
        revoke('repaired');
        state.extensionOrigin = state.expectedExtensionOrigin;
        state.pairing = {pairingId: intent.pairingId, origin: intent.expectedOrigin, tabId: input.tabId, windowId: input.windowId, documentId: input.documentId, pairedAtMs: clock(), expiresAtMs: clock() + 15 * 60_000};
        state.intent = null;
        append({type: 'paired', outcome: 'gesture_verified', origin: state.pairing.origin, documentId: state.pairing.documentId});
        return send(res, 201, {pairing: state.pairing}, state.extensionOrigin);
      }
      if (req.method === 'GET' && url.pathname === '/v1/command') {
        requireExtension(req, state.extensionOrigin); const p = requirePairing();
        if (url.searchParams.get('pairingId') !== p.pairingId) throw code('PAIRING_MISMATCH');
        return state.pending[0] ? send(res, 200, {command: state.pending[0]}, state.extensionOrigin) : send(res, 204, null, state.extensionOrigin);
      }
      if (req.method === 'POST' && url.pathname === '/v1/complete') { requireExtension(req, state.extensionOrigin); return send(res, 200, complete(await body(req)), state.extensionOrigin); }
      if (req.method === 'POST' && url.pathname === '/v1/revoke') { requireExtension(req, state.extensionOrigin); const input = await body(req); if (input.pairingId !== state.pairing?.pairingId) throw code('PAIRING_MISMATCH'); revoke('extension_kill_switch'); return send(res, 200, {revoked: true}, state.extensionOrigin); }
      if (req.method === 'GET' && url.pathname === '/v1/result') { requireCapability(req, capability); const row = state.completions.get(url.searchParams.get('commandId')); return row ? send(res, 200, row) : send(res, 404, {error: 'RESULT_UNKNOWN'}); }
      if (req.method === 'GET' && url.pathname === '/v1/stats') { requireCapability(req, capability); return send(res, 200, summarize(state.events)); }
      return send(res, 404, {error: 'ROUTE_NOT_FOUND'});
    } catch (error) { return send(res, 400, {error: error.message || 'RUNTIME_FAILED'}, req.headers.origin === state.expectedExtensionOrigin ? state.expectedExtensionOrigin : undefined); }
  });
  return {server, state, discovery, capability, prompt, complete, revoke, listen: () => new Promise((resolve) => server.listen(port, host, resolve)), close: () => new Promise((resolve) => server.close(resolve)), receiptSemantics, screenshotPolicy};
}

function scrubResult(result) { const copy = {...result}; delete copy.screenshotDataUrl; delete copy.value; if (result.screenshotDataUrl) copy.screenshot = {sha256: sha256(result.screenshotDataUrl), bytes: result.screenshotDataUrl.length}; return copy; }
function readEvents(file) { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function atomicJson(file, value) { const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, JSON.stringify(value, null, 2), {mode: 0o600}); fs.renameSync(temp, file); }
function code(message) { return Object.assign(new Error(message), {code: message}); }
function requireCapability(req, value) { if (req.headers.authorization !== `Bearer ${value}`) throw code('CAPABILITY_REQUIRED'); }
function requireExtension(req, origin) { if (!origin || req.headers.origin !== origin) throw code('EXTENSION_ORIGIN_MISMATCH'); }
async function body(req) { const chunks = []; let size = 0; for await (const c of req) { size += c.length; if (size > 12_000_000) throw code('REQUEST_TOO_LARGE'); chunks.push(c); } return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
function cors(res, origin) { res.setHeader('access-control-allow-origin', origin); res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS'); res.setHeader('access-control-allow-headers', 'content-type'); res.setHeader('vary', 'Origin'); }
function send(res, status, value, origin) { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); if (origin?.startsWith('chrome-extension://')) cors(res, origin); res.end(status === 204 ? '' : JSON.stringify(value)); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const runtime = createRuntime({port: Number(process.env.PORCHLIGHT_PORT || 9235), dataDir: process.env.PORCHLIGHT_DATA_DIR});
  await runtime.listen();
  process.stdout.write(JSON.stringify({ready: true, url: 'http://127.0.0.1:9235', capability: runtime.capability}) + '\n');
}
