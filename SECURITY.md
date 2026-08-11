# Security policy

Please report a vulnerability through GitHub's private security-advisory interface for this repository. Do not place credentials, session material, private portal data, or exploit details in a public issue.

Porchlight binds first pairing to the extension origin derived from the manifest public key. Wrong origins must be rejected before pair-intent disclosure, CORS preflight, token acceptance, polling, completion, or revocation.

The runtime listens only on loopback. It has no cookie permission, broad host permission, native messaging permission, OCR, model, or network-inference dependency. Native file pickers and browser chrome remain outside DOM authority.

Security fixes need a deterministic negative test and exact-head CI evidence.
