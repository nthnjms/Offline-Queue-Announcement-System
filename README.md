# Offline Queue Announcement System

A lightweight, fully offline queue-calling system for a barangay/government
office counter. Two pages — a Control Panel for the operator and a Public
Display for the TV/projector — talk to each other instantly over
BroadcastChannel (with a localStorage-event fallback), announce tickets by
voice via the browser's Speech Synthesis API, and persist settings/history
to localStorage. No backend, no database, no build step, no dependencies.

## Running it

This is a static site — any static host works. Two ways to run it:

**Locally**, from inside `queue-system/`:
```
python3 -m http.server 8080
```
then visit `http://localhost:8080/`. (Opening the HTML files directly via
`file://` can block `<script type="module">` in some browsers — serving
over `localhost` avoids that, and `localhost` isn't the internet, so this
is still fully offline.)

**Deployed** (e.g. Vercel), from inside `queue-system/`:
```
npx vercel --prod
```
No `vercel.json` needed — it's a plain static site, and `index.html` at
the root is served automatically for the bare domain.

## Setting up on the day

1. Open **`index.html`** (the bare domain, or `index.html` locally) —
   it's a landing page with links to both pages and setup steps.
2. Open **Control Panel** on the operator's computer.
3. Open **Public Display** on the TV/projector (or a second monitor),
   then use the ⛶ button in its bottom-right corner for fullscreen.
4. On the Display screen, tap once when prompted — browsers require one
   real click before they'll allow announcement audio to play; this is a
   one-time step per session, not a bug.
5. In Control Panel, open **Settings** to set office name, logo, counter
   count, and theme color before you start.
6. Call a ticket — the Display updates, rings, flashes, and announces it
   instantly.

## File map

```
queue-system/
  index.html              ← landing page: links + setup instructions
  control-panel.html       ← operator's page
  display.html               ← TV/projector page

  css/
    base.css                 ← ALL design tokens (colors, type, spacing).
                                Every other CSS file should reference these
                                variables, not add new hex values.
    index.css                 ← landing page styles
    control-panel.css          ← Control Panel layout/components
    display.css                 ← Display layout/components

  js/
    comms.js                    ← the ONLY file allowed to touch
                                   BroadcastChannel. Everything else talks
                                   to this module's send()/onMessage().
                                   This is what makes a future swap to a
                                   local WebSocket (multi-computer support)
                                   a one-file change instead of a rewrite.
    state.js                     ← source of truth for the current ticket +
                                   last-5 history, persisted to localStorage
    speech.js                     ← Speech Synthesis queue (FIFO, no
                                   overlapping announcements)
    settings.js                    ← settings load/save/import/export,
                                   validated + clamped
    control-panel.js                ← Control Panel page wiring
    display.js                       ← Display page wiring

  assets/
    bell.mp3                         ← you provide this
    logo-placeholder.png              ← optional fallback logo

  tests/
    (see tests/README.md)             ← Node-based test suite, one file
                                       per chunk, 121 automated checks total
```

## The one rule that keeps this expandable

Only `comms.js` is allowed to know about `BroadcastChannel`. When this
grows to support multiple computers on a local network, that's a rewrite
of one file — not a hunt through every page script.

## Known gaps / possible future work

Not currently built:
- Multi-tab detection warning (if two Control Panel tabs are open at once)
- No-show / skip ticket handling
- CSV export of the running call log (separate from the settings
  export/import that already exists)
- Full ARIA live-region coverage (ticket number and connection status are
  covered; the settings form and history list aren't fully)
