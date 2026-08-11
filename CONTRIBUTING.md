# Contributing to Porchlight

Porchlight accepts small, reviewable site-pack pull requests from people and deterministic workers.

## Evidence gate

A route needs at least three verified successes across at least two document instances. Every route needs a deterministic postcondition. A click, submit, upload, send, or file action is never evidence of remote receipt or indexing.

## Public-data boundary

A pull request may include a public HTTPS origin and reusable structural facts. It must not include URL paths or query strings, accounts, field values, raw DOM, screenshots, cookies, credentials, claim/case numbers, confirmation numbers, or user identifiers.

Run `npm test`, `npm run build`, and `npm run freshness` before opening a PR. CI fails closed on schema, evidence, privacy, runtime, extension-identity, and freshness violations.

A worker should open one branch and one PR per site pack. Human reviewers retain merge authority.
