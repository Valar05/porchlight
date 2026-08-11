/* global globalThis */
'use strict';

(() => {
  if (globalThis.__PORCHLIGHT_EXECUTE__) return;
  const text = (v, n = 300) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const role = (el) => el.getAttribute('role') || ({A: 'link', BUTTON: 'button', INPUT: el.type === 'checkbox' ? 'checkbox' : 'textbox', SELECT: 'combobox', TEXTAREA: 'textbox'}[el.tagName] || 'generic');
  const name = (el) => text(el.getAttribute('aria-label') || (el.labels && [...el.labels].map((x) => x.textContent).join(' ')) || el.getAttribute('title') || el.getAttribute('placeholder') || el.textContent);
  const cssPath = (el) => {
    if (el.id && /^[A-Za-z][\w:.-]{0,100}$/.test(el.id)) return `#${CSS.escape(el.id)}`;
    const test = el.getAttribute('data-testid'); if (test && test.length < 100) return `[data-testid="${CSS.escape(test)}"]`;
    const parts = []; let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) { let part = node.tagName.toLowerCase(); const peers = node.parentElement ? [...node.parentElement.children].filter((x) => x.tagName === node.tagName) : []; if (peers.length > 1) part += `:nth-of-type(${peers.indexOf(node) + 1})`; parts.unshift(part); node = node.parentElement; }
    return parts.join(' > ');
  };
  const ref = (el, i) => `p:${i}:${btoa(unescape(encodeURIComponent(`${role(el)}|${name(el)}|${cssPath(el)}`))).replace(/=+$/, '').slice(-32)}`;
  function inventory() {
    const candidates = [...document.querySelectorAll('a,button,input,select,textarea,[role],[contenteditable="true"],summary')].filter(visible).slice(0, 800);
    return {url: location.href, origin: location.origin, title: document.title, bodyTextLength: text(document.body?.innerText, 20000).length, visualSurface: Boolean(document.querySelector('canvas,video')), elements: candidates.map((el, i) => ({ref: ref(el, i), role: role(el), name: name(el), tag: el.tagName.toLowerCase(), type: text(el.type, 40), disabled: Boolean(el.disabled), checked: 'checked' in el ? Boolean(el.checked) : undefined, selected: el.tagName === 'SELECT' ? text(el.selectedOptions?.[0]?.textContent) : undefined, selector: cssPath(el)}))};
  }
  function resolve(target) {
    const items = inventory().elements.filter((x) => !x.disabled);
    if (target?.ref) { const hit = items.filter((x) => x.ref === target.ref); if (hit.length === 1) return hit[0]; }
    if (target?.role && target?.name) { const hit = items.filter((x) => x.role === target.role && x.name.toLowerCase() === target.name.toLowerCase()); if (hit.length === 1) return hit[0]; if (hit.length > 1) throw new Error('TARGET_AMBIGUOUS'); }
    if (target?.name) { const exact = items.filter((x) => x.name.toLowerCase() === target.name.toLowerCase()); if (exact.length === 1) return exact[0]; if (exact.length > 1) throw new Error('TARGET_AMBIGUOUS'); const contains = items.filter((x) => x.name.toLowerCase().includes(target.name.toLowerCase())); if (contains.length === 1) return contains[0]; if (contains.length > 1) throw new Error('TARGET_AMBIGUOUS'); }
    throw new Error('TARGET_NOT_FOUND');
  }
  const element = (row) => document.querySelector(row.selector);
  const fingerprint = (snap) => JSON.stringify({url: snap.url, title: snap.title, elements: snap.elements.map((x) => [x.role, x.name, x.disabled, x.checked, x.selected])});
  async function execute(command) {
    const before = inventory();
    if (command.action === 'observe') return {verified: true, observation: before, locatorStrategy: 'semantic_inventory'};
    if (command.action === 'find' || command.action === 'read') { const row = resolve(command.target); return {verified: true, target: {...row, selector: undefined}, locatorStrategy: command.target.ref ? 'stable_ref' : 'accessible_name'}; }
    if (command.action === 'scroll') { const y = scrollY; scrollBy({top: command.direction === 'up' ? -Math.max(300, innerHeight * .8) : Math.max(300, innerHeight * .8), behavior: 'instant'}); await new Promise((r) => setTimeout(r, 80)); return {verified: scrollY !== y || document.documentElement.scrollHeight <= innerHeight, locatorStrategy: 'window_scroll'}; }
    const row = resolve(command.target); const el = element(row); if (!el) throw new Error('TARGET_STALE');
    if (command.action === 'set_value') { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set; setter ? setter.call(el, command.value) : (el.value = command.value); el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); }
    else if (command.action === 'select') { const option = [...el.options].filter((x) => text(x.textContent).toLowerCase() === String(command.value).toLowerCase()); if (option.length !== 1) throw new Error(option.length ? 'OPTION_AMBIGUOUS' : 'OPTION_NOT_FOUND'); el.value = option[0].value; el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); }
    else if (['click', 'submit', 'send', 'file'].includes(command.action)) el.click();
    else throw new Error('ACTION_UNSUPPORTED');
    await new Promise((r) => setTimeout(r, 180));
    const after = inventory(); const refreshed = (() => { try { return resolve(command.target); } catch { return null; } })();
    let verified = fingerprint(before) !== fingerprint(after);
    if (command.action === 'set_value') verified = Boolean(refreshed && element(refreshed)?.value === command.value);
    if (command.action === 'select') verified = Boolean(refreshed && text(element(refreshed)?.selectedOptions?.[0]?.textContent).toLowerCase() === String(command.value).toLowerCase());
    return {verified, locatorStrategy: command.target.ref ? 'stable_ref' : 'accessible_name', refHint: row.ref, before: {url: before.url, title: before.title}, after: {url: after.url, title: after.title}, reason: verified ? '' : 'POSTCONDITION_MISMATCH'};
  }
  globalThis.__PORCHLIGHT_EXECUTE__ = execute;
})();
