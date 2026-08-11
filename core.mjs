import {createHash, randomUUID} from 'node:crypto';

export const PRODUCT = 'Porchlight';
export const VERSION = '0.8.1';
export const SCHEMA = 'porchlight.runtime.v1';
export const MOTIVATED_MODE = Object.freeze({status: 'central_permanent', ownOutcome: true, obviousAdjacentImprovement: true, boundedRecovery: true, authorityExpansion: false});
export const OBSERVE = new Set(['observe', 'find', 'read', 'screenshot']);
export const PAGE_MUTATIONS = new Set(['click', 'set_value', 'select', 'scroll']);
export const COMMIT_ACTIONS = new Set(['submit', 'send', 'file']);

export const sha256 = (value) => createHash('sha256').update(String(value), 'utf8').digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

const clean = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function parsePrompt(input) {
  const source = clean(input, 4000);
  const lower = source.toLowerCase();
  if (!source) return {kind: 'help'};
  if (/^(help|\?)$/.test(lower)) return {kind: 'help'};
  if (/^(look|observe|status|where am i|what page|refresh dom)$/.test(lower)) return {kind: 'command', action: 'observe'};
  if (/^(stats|metrics|is it helping)$/.test(lower)) return {kind: 'stats'};
  if (/^(pair|connect)\s+https?:\/\//i.test(source)) return {kind: 'pair', origin: new URL(source.replace(/^(pair|connect)\s+/i, '')).origin};
  if (/^(unpair|disconnect|revoke)$/.test(lower)) return {kind: 'revoke'};
  if (/^(screenshot|show page)$/.test(lower)) return {kind: 'command', action: 'screenshot', reason: 'explicit_request'};
  if (/^(upload|attach|choose file|add file)\b/.test(lower)) return {kind: 'native', lane: 'computer_hands', reason: 'Native file pickers require an OS-level operator.'};
  if (/^scroll\s+(up|down)$/.test(lower)) return {kind: 'command', action: 'scroll', direction: lower.endsWith('up') ? 'up' : 'down'};
  const approve = source.match(/^approve\s+([a-f0-9]{64})$/i);
  if (approve) return {kind: 'approve', digest: approve[1].toLowerCase()};
  const click = source.match(/^(click|press|open)\s+["“]([^"”]+)["”]$/i);
  if (click) return {kind: 'command', action: 'click', target: {name: clean(click[2])}};
  const read = source.match(/^(read|find)\s+["“]([^"”]+)["”]$/i);
  if (read) return {kind: 'command', action: read[1].toLowerCase(), target: {name: clean(read[2])}};
  const type = source.match(/^(type|enter|put)\s+["“]([^"”]*)["”]\s+(in|into)\s+["“]([^"”]+)["”]$/i);
  if (type) return {kind: 'command', action: 'set_value', value: type[2], target: {name: clean(type[4])}};
  const select = source.match(/^(choose|select)\s+["“]([^"”]+)["”]\s+(in|from)\s+["“]([^"”]+)["”]$/i);
  if (select) return {kind: 'command', action: 'select', value: clean(select[2]), target: {name: clean(select[4])}};
  const commit = source.match(/^(submit|send|file)\s+["“]([^"”]+)["”]$/i);
  if (commit) return {kind: 'stage_commit', action: commit[1].toLowerCase(), target: {name: clean(commit[2])}};
  return {kind: 'unknown', reason: 'No deterministic grammar rule matched.'};
}

export function screenshotPolicy({explicit = false, sparse = false, visualSurface = false, misses = 0, documentChanged = false, postconditionMismatch = false, lastCaptureMs = 0, nowMs = Date.now()}) {
  let reason = '';
  if (explicit) reason = 'explicit_request';
  else if (sparse) reason = 'dom_sparse';
  else if (misses >= 2) reason = 'target_failed_twice';
  else if (documentChanged) reason = 'unexpected_document_change';
  else if (visualSurface) reason = 'visual_surface';
  else if (postconditionMismatch) reason = 'postcondition_mismatch';
  return {capture: Boolean(reason) && (explicit || nowMs - lastCaptureMs >= 10_000), reason};
}

export function commandDigest(command) {
  return sha256(canonical({action: command.action, target: command.target || {}, valueHash: command.value == null ? '' : sha256(command.value)}));
}

export function stageApproval(command, binding, nowMs = Date.now()) {
  if (!COMMIT_ACTIONS.has(command.action)) throw new Error('Only a commit action can be staged');
  const digest = commandDigest(command);
  return {approvalId: randomUUID(), digest, command: {...command, value: command.value}, binding: {...binding}, createdAtMs: nowMs, expiresAtMs: nowMs + 120_000, consumed: false};
}

export function consumeApproval(staged, digest, binding, nowMs = Date.now()) {
  if (!staged || staged.consumed) throw new Error('APPROVAL_UNKNOWN');
  if (staged.expiresAtMs <= nowMs) throw new Error('APPROVAL_EXPIRED');
  if (staged.digest !== digest) throw new Error('APPROVAL_DIGEST_MISMATCH');
  for (const key of ['pairingId', 'tabId', 'documentId', 'origin']) if (staged.binding[key] !== binding[key]) throw new Error('APPROVAL_SCOPE_MISMATCH');
  staged.consumed = true;
  return {...staged.command, approval: {approvalId: staged.approvalId, digest: staged.digest, approvedAtMs: nowMs}};
}

export function safeEvent(input) {
  const event = {
    schema: SCHEMA,
    eventId: input.eventId || randomUUID(),
    at: input.at || new Date().toISOString(),
    type: clean(input.type, 80),
    action: clean(input.action, 40),
    outcome: clean(input.outcome, 80),
    reason: clean(input.reason, 160),
    durationMs: Math.max(0, Number(input.durationMs) || 0),
    retries: Math.max(0, Number(input.retries) || 0),
    locatorStrategy: clean(input.locatorStrategy, 80),
    originHash: input.origin ? sha256(new URL(input.origin).origin) : '',
    documentHash: input.documentId ? sha256(input.documentId) : '',
    targetHash: input.targetName ? sha256(clean(input.targetName).toLowerCase()) : '',
    valueHash: input.value == null ? '' : sha256(input.value),
    screenshotReason: clean(input.screenshotReason, 80),
    postconditionVerified: Boolean(input.postconditionVerified),
    modelUsed: false,
    networkInferenceUsed: false,
    motivatedMode: MOTIVATED_MODE.status,
  };
  event.receiptHash = sha256(canonical(event));
  return event;
}

export function summarize(events) {
  const commands = events.filter((e) => e.type === 'command_completed');
  const successes = commands.filter((e) => e.outcome === 'verified');
  const failures = commands.filter((e) => e.outcome !== 'verified');
  const screenshots = commands.filter((e) => e.action === 'screenshot');
  const sorted = commands.map((e) => e.durationMs).sort((a, b) => a - b);
  return {
    commands: commands.length,
    verified: successes.length,
    verificationRate: commands.length ? successes.length / commands.length : 0,
    failures: failures.length,
    screenshots: screenshots.length,
    medianLatencyMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
    modelCalls: 0,
    networkInferenceCalls: 0,
  };
}

export function receiptSemantics(adapter, result) {
  const claim = clean(result?.claim, 80);
  const allowed = new Set(adapter?.receiptClaims || ['page_action_verified']);
  if (!allowed.has(claim)) return {accepted: false, state: 'unconfirmed', reason: 'Adapter does not recognize this receipt claim.'};
  if (claim === 'page_action_verified') return {accepted: true, state: 'page_action_verified'};
  if (claim === 'remote_received' && result?.remoteEvidence?.confirmationId) return {accepted: true, state: 'received_confirmed'};
  return {accepted: false, state: 'submitted_unconfirmed', reason: 'Remote receipt or indexing evidence is absent.'};
}
