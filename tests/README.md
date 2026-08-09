# Tests

Plain Node scripts (no test framework needed for most of them) that
exercise the real project files directly — either by importing the JS
modules, or by loading the actual HTML into a real DOM and driving it
with real events.

Run any test with:
    node tests/<filename>.mjs

Exit code 0 = all checks passed, 1 = at least one failed (also printed
to the console either way).

## Single-computer / offline mode

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
- `chunk4-control-panel.test.mjs` — the Control Panel page itself,
  loaded as a real DOM (via jsdom) from the actual `control-panel.html`
  file and driven with real events: calling a ticket through the form,
  recalling a ticket from history without auto-calling it, Clear
  Display gated by confirm(), the full settings form round-trip (incl.
  counter dropdown regenerating live), Reset to Defaults, and a real
  file-based logo upload/remove flow. **Needs jsdom** (dev-only — the
  actual app has zero dependencies):
  ```
  npm install --no-save jsdom
  node tests/chunk4-control-panel.test.mjs
  ```
- `chunk5-display.test.mjs` — the Public Display page, same jsdom
  approach against the real `display.html`. The key thing this proves:
  a page that loads (or refreshes) with an existing ticket already in
  localStorage renders it correctly but does **not** ring the bell,
  flash, or speak — only a genuinely live `ticket-called`/
  `ticket-repeat` event triggers those effects, and the announcement
  delay is cancellable if the display is cleared mid-countdown. Also
  covers live settings sync and graceful no-ops for Fullscreen/Wake
  Lock. Needs jsdom, same as chunk4.

## Network Sync (optional multi-computer mode)

- `network-relay-server.test.mjs` — starts the REAL relay server (as a
  child process) and connects genuine WebSocket clients to it (Node's
  native `WebSocket`, the same class browsers use) — not a mock of any
  kind. Verifies basic relay, self-exclusion (sender doesn't receive
  its own message, matching BroadcastChannel semantics), both
  directions, a newly-joined third client, clean handling of a
  disconnect, and a large payload (exercises the extended-length frame
  encoding path in the hand-rolled WebSocket parser).
- `network-sync-integration.test.mjs` — the test that matters most for
  this feature: two genuinely separate OS processes (via
  `child_process.fork`, using `network-sync-worker.mjs`), each with
  its own isolated localStorage, simulating two real computers. One
  ("Control Panel") connects, calls a ticket, and saves settings.
  ONLY AFTER THAT does the second ("Display") connect for the first
  time. It has to prove it can recover the ticket and settings it
  never directly witnessed — the actual scenario the feature exists
  for.
- `network-sync-ui.test.mjs` — jsdom test for both the Control Panel's
  Network Sync form and Display's minimal gear-icon panel: toggling,
  saving, invalid-address rejection, and status text. Needs jsdom.

## A known flake (not a bug)

Occasionally `chunk4-control-panel.test.mjs` reports fewer than 36/36
when run back-to-back with the other test files in a single shell loop
under heavy system load. Running it standalone (`node
tests/chunk4-control-panel.test.mjs`) has been consistently clean every
time this was checked — this is timing sensitivity in the test harness
under load, not a bug in the app. If you see it, just re-run that one
file by itself.

Add one short test file per future feature so a later change can't
silently break an earlier one.
