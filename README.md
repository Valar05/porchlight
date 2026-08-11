# Porchlight Internet Access Map

Porchlight is a living, community-reviewed map of how people and assistive tools can use the web. It maps public origins, reusable page archetypes, accessible landmarks and controls, task routes, deterministic postconditions, known accessibility failures, native/DOM boundaries, and freshness evidence.

**The map is the product.** The local paired-tab runtime is one deterministic discovery and verification worker. It contains no model, embeddings, OCR, or network inference.

Status: **public beta 0.8.1**. The source and hostile-origin contract are tested. Installation, pairing, and any site action remain local acts performed by each user.

## Install a local worker

Requirements: Node.js 22+ and Chromium/Chrome with permission to load an unpacked extension.

```sh
git clone https://github.com/Valar05/porchlight.git
cd porchlight
npm test
npm start
```

Load the `extension/` folder as an unpacked extension. Its manifest public key fixes the extension ID at `dmfjnjkccebgbiepjbmbdmpffcaikaje`; the loopback daemon rejects every other extension origin before disclosing a pair intent, answering preflight, or accepting a token.

At the `porchlight>` prompt, run `pair https://example.com`, open that exact origin in an ordinary tab, and click the extension. The lease is tab-bound, lasts fifteen minutes, and a second click revokes it.

The deterministic grammar is: `look`, `click “Name”`, `read “Name”`, `type “value” into “Field”`, `choose “Option” in “Field”`, `scroll down`, `screenshot`, `submit “Button”`, `approve DIGEST`, `stats`, and `revoke`.

## How the map learns

A route graduates only after at least three verified successes across at least two document instances. A site-pack PR may contain only a public HTTPS origin, page archetype, generic task, safe public accessible label, role, locator strategy, deterministic postcondition, aggregate evidence, known accessibility failure, and freshness timestamps.

A contribution never contains URL paths or query strings, accounts, typed values, cookies, credentials, raw DOM, screenshots, claim/case numbers, or user identifiers. Authenticated pages may contribute reusable structure, never session content.

Set `PORCHLIGHT_CONTRIBUTION_MODE` to:

- `local-only` — learn locally and publish nothing;
- `approval` — prepare the sanitized site pack and ask before publication;
- `automatic` — create a branch and GitHub PR after graduation and privacy validation.

`PORCHLIGHT_CONTRIBUTION_REPO` defaults to `Valar05/porchlight`.

## Receipt truth

A verified page action proves only that page action. It does not prove remote receipt, delivery, filing, or indexing. A remote-received claim remains `submitted_unconfirmed` until separate confirmation evidence exists.

## Motivated Mode

Motivated Mode is permanent: own the requested outcome, turn verified use into the obvious reusable map improvement, recover through bounded DOM refresh and sparse screenshots, and stop instead of flailing or expanding authority.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [state.md](state.md).
