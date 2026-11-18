# patched-runtime branch

This branch is NOT source code. It is the **exact deployed runtime artifact**
of dsh-zcode-cli 0.3.1 with local operating patches, taken from a live DSH
install on 2026-11-19 and verified end to end:

- spawned CLI children report ZCode/3.18.2 (3012 client-not-supported fixed)
- model requests verified against https://zcode.z.ai (819k input tokens OK)
- image attachments, stop-generation, new-session history seed, fork replay
  all green on the live bridge

The upstream `main` branch of this fork keeps the original TypeScript source
(`src/` -> `lib/` via tsc). This branch exists because the npm-published 0.3.1
and the GitHub sources have drifted (the author publishes npm ahead of the
repo); porting the local patches back into `src/` is tracked in
LOCAL-CHANGES.md.

Install: copy this tree over `node_modules/dsh-zcode-cli` in the DSH profile,
or `pnpm add dsh-zcode-cli@file:<this-folder>`.
