# Tests

Plain Node scripts (no test framework needed) that exercise the JS
modules directly, simulating two browser tabs talking to each other.

Run any test with:
    node tests/<filename>.mjs

Exit code 0 = all checks passed, 1 = at least one failed (also printed
to the console either way).

- `chunk1-comms-state.test.mjs` — comms.js message delivery (incl.
  heartbeat) and state.js business logic (call/repeat/clear, history
  cap, persistence + recovery-on-load).
- `chunk2-speech.test.mjs` — speech.js against a fake Speech Synthesis
  API that mimics the real quirks it exists to handle: voices not
  ready on first call, async utterance completion, FIFO ordering with
  no overlap, default vs. custom announcement phrasing, rate/volume
  clamping, clearQueue(), and graceful no-op when the API is missing
  entirely.
- `chunk3-settings.test.mjs` — settings.js: field validation/clamping
  (counter count, theme color, speech rate/volume, blank office name),
  persistence + recovery-on-load, resilience to a corrupted stored
  value, cross-tab broadcast of `settings-updated`, the logo size
  warning threshold, and the export/import round-trip (incl. rejecting
  invalid JSON and wrong-shaped payloads).

Add one short test file per future chunk (e.g. `chunk2-speech.test.mjs`)
so a change in a later chunk can't silently break an earlier one.
