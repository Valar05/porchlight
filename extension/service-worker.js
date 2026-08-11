/* global chrome */
'use strict';
const ROOT = 'http://127.0.0.1:9235/v1';
let pairing = null;
let running = false;

chrome.runtime.onStartup.addListener(restore);
chrome.runtime.onInstalled.addListener(restore);
restore();

chrome.action.onClicked.addListener(async (tab) => {
  if (pairing) return revoke(tab.id);
  try {
    const intent = await get('/pair-intent');
    const [{documentId, result}] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: () => ({url: location.href, origin: location.origin})});
    if (result.origin !== intent.expectedOrigin) throw new Error('ORIGIN_MISMATCH');
    const response = await post('/pair', {token: intent.token, url: result.url, tabId: tab.id, windowId: tab.windowId, documentId});
    pairing = response.pairing;
    await chrome.storage.session.set({pairing});
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['content-executor.js']});
    await chrome.action.setBadgeText({tabId: tab.id, text: 'ON'});
    await chrome.action.setBadgeBackgroundColor({tabId: tab.id, color: '#176B3A'});
    poll();
  } catch (error) { console.error('Porchlight pair failed', error); }
});

async function poll() {
  if (running || !pairing) return; running = true;
  try {
    while (pairing) {
      const response = await fetch(`${ROOT}/command?pairingId=${encodeURIComponent(pairing.pairingId)}`, {cache: 'no-store'});
      if (response.status === 204) { await pause(250); continue; }
      if (!response.ok) throw new Error(`COMMAND_${response.status}`);
      const {command} = await response.json(); let result;
      try {
        if (command.action === 'screenshot') {
          const screenshotDataUrl = await chrome.tabs.captureVisibleTab(pairing.windowId, {format: 'png'});
          result = {verified: Boolean(screenshotDataUrl), screenshotDataUrl, screenshotReason: command.reason || 'explicit_request', locatorStrategy: 'visible_tab_capture'};
        } else {
          const [row] = await chrome.scripting.executeScript({target: {tabId: pairing.tabId}, func: (cmd) => globalThis.__PORCHLIGHT_EXECUTE__(cmd), args: [command]});
          result = row.result;
        }
      } catch (error) { result = {verified: false, code: error.message, reason: error.message}; }
      await post('/complete', {pairingId: pairing.pairingId, commandId: command.commandId, result});
    }
  } catch (error) { console.error('Porchlight stopped', error); pairing = null; }
  finally { running = false; }
}
async function restore() { const saved = await chrome.storage.session.get('pairing'); if (saved.pairing) { pairing = saved.pairing; poll(); } }
async function revoke(tabId) { if (pairing) { try { await post('/revoke', {pairingId: pairing.pairingId}); } catch {} } pairing = null; await chrome.storage.session.remove('pairing'); await chrome.action.setBadgeText({tabId, text: ''}); }
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(path) { const r = await fetch(ROOT + path, {cache: 'no-store'}); if (!r.ok) throw new Error(`HTTP_${r.status}`); return r.json(); }
async function post(path, value) { const r = await fetch(ROOT + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(value)}); if (!r.ok) throw new Error((await r.json()).error || `HTTP_${r.status}`); return r.json(); }
