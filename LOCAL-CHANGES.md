
- lib/provider/zcode.js (2026-11-19): reasoning streaming deltas now emit
  `reasoning-delta` instead of `text-delta` (contract per dsh-zcode-startplan
  stream-translator). Previously thinking streamed as body text and only
  collapsed into a thinking block at block-end.
