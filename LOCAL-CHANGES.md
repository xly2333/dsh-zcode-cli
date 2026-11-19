
- lib/provider/zcode.js (2026-11-19): reasoning streaming deltas now emit
  `reasoning-delta` instead of `text-delta` (contract per dsh-zcode-startplan
  stream-translator). Previously thinking streamed as body text and only
  collapsed into a thinking block at block-end.

- lib/zcode/app-server.js (2026-11-19): the protocol wire log is now OFF by
  default (ZCODE_WIRE_LOG=1 re-enables it with 8MB rotation). The ungated log
  reached 383MB of unbounded growth, contradicting the plugin-resident,
  clean-shutdown lifecycle goal.

- lib/zcode/app-server.js (2026-11-20): the process cache is keyed by
  conversationId, so with many concurrent sessions the LRU cap (4) evicted
  OTHER conversations' in-flight app-server processes mid-turn. close() on a
  busy process rejected its pending RPCs as "ZCode app-server session was
  torn down" and SIGKILLed the child, dying as "exited (code 1)" with empty
  stderr. Eviction is now busy-aware: busy processes are only unlinked from
  the cache (their own turn finally closes them), LRU victim selection skips
  busy processes (cache may temporarily exceed the cap), and armIdle re-arms
  instead of killing while busy.

- lib/provider/zcode.js (2026-11-20): when the CLI's failed terminal event
  carries no errorCode (upstream free-route throttle windows), the previous
  fallback discarded terminal.errorMessage as well, surfacing only the vague
  "turn failed without an error code" and hiding real causes such as
  "exceed quota limit". The terminal's errorMessage is now passed through.
