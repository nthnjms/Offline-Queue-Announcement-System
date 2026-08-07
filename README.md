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

Add one short test file per future chunk (e.g. `chunk2-speech.test.mjs`)
so a change in a later chunk can't silently break an earlier one.
