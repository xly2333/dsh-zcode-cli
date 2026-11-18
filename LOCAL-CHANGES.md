
- lib/provider/zcode.js (2026-11-19): reasoning streaming deltas now emit
  `reasoning-delta` instead of `text-delta` (contract per dsh-zcode-startplan
  stream-translator). Previously thinking streamed as body text and only
  collapsed into a thinking block at block-end.

- lib/zcode/app-server.js (2026-11-19): the protocol wire log is now OFF by
  default (ZCODE_WIRE_LOG=1 re-enables it with 8MB rotation). The ungated log
  reached 383MB of unbounded growth, contradicting the plugin-resident,
  clean-shutdown lifecycle goal.
