# Offline Queue Announcement System — Project Skeleton (Chunk 0)

## How to run this right now

Nothing works yet except page loads — this is the skeleton chunk. To check
it's wired up correctly:

1. Open `control-panel.html` directly in a browser (double-click it, or
   drag it into a browser window). No server needed.
2. Open `display.html` in a **second tab or window**.
3. Open the browser console (F12) on both pages. You should see:
   `[comms.js] loaded — Chunk 1 not yet implemented`
   (and similar lines for state.js, settings.js, etc.)
   That confirms every file path resolves and the `<script type="module">`
   tags are loading correctly.

Once real logic gets built in each chunk, running the system for real will
still be exactly this: open both HTML files as local files, no server,
no build step, no npm install. That constraint is intentional — it's what
keeps this deployable on a bare Windows PC in a barangay hall with zero
setup.

**One catch to know about now:** some browsers restrict `type="module"`
scripts from loading via the `file://` protocol (CORS-style restrictions
on local files). If you open the HTML files directly and the console
shows module loading errors instead of the "loaded" messages above, the
fix is to serve the folder over `localhost` instead of `file://` — e.g.
Python's built-in `python -m http.server` run from inside `queue-system/`,
then visit `http://localhost:8000/control-panel.html`. Still 100% offline,
still no internet required — `localhost` isn't the internet. We'll
confirm which approach your target machine needs when we get to testing.

## Where everything goes (map for future chunks)

```
queue-system/
  control-panel.html     ← operator's page. Structure only right now.
  display.html            ← TV/projector page. Structure only right now.

  css/
    base.css               ← ALL design tokens (colors, type, spacing) live
                              here. Chunk 0, essentially done. Future chunks
                              should reference these variables, not add new
                              hex values.
    control-panel.css      ← Control Panel layout/components. Chunk 4.
    display.css             ← Display layout/components. Chunk 5.

  js/
    comms.js                ← Chunk 1. ONLY file allowed to touch
                               BroadcastChannel. Everything else talks to
                               this module.
    state.js                 ← Chunk 1. Source of truth for current ticket
                               + history, persisted to localStorage.
    speech.js                 ← Chunk 2. Speech Synthesis queue.
    settings.js                ← Chunk 3. Settings load/save/import/export.
    control-panel.js            ← Chunk 4. Control Panel page wiring.
    display.js                   ← Chunk 5. Display page wiring.

  assets/
    bell.mp3                 ← you provide this (see assets/README.txt)
    logo-placeholder.png       ← you provide this
```

## The one rule that keeps this expandable

Only `comms.js` is allowed to know about `BroadcastChannel`. When this
grows to support multiple computers on a local network later, that's a
rewrite of one file — not a hunt through every page script.

## Chunk order (rest of the project)

1. **comms.js + state.js** — communication layer + state recovery
2. **speech.js** — voice announcement queue
3. **settings.js** — settings persistence
4. **control-panel.js** + control-panel.css — operator UI
5. **display.js** + display.css — public display UI
6. Polish: multi-tab warning, confirm-before-clear, no-show handling,
   CSV export, ARIA live region

Each chunk is built and tested before the next starts.
