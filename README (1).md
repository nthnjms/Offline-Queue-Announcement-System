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
- `chunk4-control-panel.test.mjs` — the Control Panel page itself,
  loaded as a real DOM (via jsdom) from the actual `control-panel.html`
  file and driven with real events: calling a ticket through the form,
  the validation hint, recalling a ticket from history without
  auto-calling it, Clear Display gated by confirm(), the full settings
  form round-trip (incl. counter dropdown regenerating live), Reset to
  Defaults, and a real file-based logo upload/remove flow. **This one
  needs jsdom** (dev-only — the actual app has zero dependencies):
  ```
  npm install --no-save jsdom
  node tests/chunk4-control-panel.test.mjs
  ```
- `chunk5-display.test.mjs` — the Public Display page, same jsdom
  approach against the real `display.html`. The one thing this test
  exists to prove: a page that loads (or refreshes) with an existing
  ticket already in localStorage renders it correctly but does **not**
  ring the bell, flash, or speak — only a genuinely live
  `ticket-called`/`ticket-repeat` event (sent here from a real second
  `comms.js` instance, simulating an actual Control Panel tab) triggers
  those effects. Also covers settings applying live (office name, logo,
  theme color, footer), `display-cleared` cancelling in-progress speech,
  and graceful no-ops for Wake Lock/Fullscreen when unavailable. Needs
  jsdom, same as chunk4.
- `chunk5-display.test.mjs` — the Public Display page, same jsdom
  approach. The key thing this verifies: loading the page with a
  ticket already on screen (recovery from localStorage, e.g. a
  refresh) does NOT ring the bell, flash, or speak — only a genuinely
  live `ticket-called`/`ticket-repeat` broadcast does. Also covers
  Repeat, Clear Display cancelling in-progress speech, live settings
  sync (office name/logo/theme/footer), and graceful no-ops for
  Fullscreen/Wake Lock APIs the test environment doesn't support.

Add one short test file per future chunk (e.g. `chunk2-speech.test.mjs`)
so a change in a later chunk can't silently break an earlier one.
