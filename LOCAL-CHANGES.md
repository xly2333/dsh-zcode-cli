# Local patches (2026-11-18/19)

This fork carries local operating patches applied on a live DSH install.
All changes verified against the running system (see commit for details).

- bootstrap-env.js: derive `ZCODE_APP_VERSION` from the active desktop runtime
  snapshot when the host env lacks it. Without it the spawned CLI falls back to
  the stale bundle version (0.17.1) and zcode.z.ai rejects every turn with
  HTTP 405 / code 3012 "This client is not supported".
- lib/zcode/process.js: add `ZCODE_APP_VERSION` to `ZCODE_ENV_ALLOWLIST` so the
  closed child-env allowlist passes the client-version fingerprint through.
- bootstrap-env.js: deriveCliProviderConfig now corrects the GLM-5.3-Flash
  `contextWindow` in the derived CLI provider config to 1000000 (aligned with
  the desktop source; the derived copy had drifted to 400000) and bumps the
  derivation stamp to v2 so a previously wrong copy self-heals on next start.
- Measured: server accepted 819,037 input tokens on this route (2x the old
  400k declaration), consistent with a 1M real window.
