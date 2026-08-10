# Offline Queue Announcement System

A lightweight queue-calling system for a barangay/government office
counter. Two pages — a Control Panel for the operator and a Public
Display for the TV/projector — talk to each other instantly, announce
tickets by voice via the browser's Speech Synthesis API, and persist
settings/history to localStorage. No build step, no required
dependencies, works entirely on one computer by default.

Two modes, chosen with a single setting:

- **Single-computer (default)** — Control Panel and Display run as two
  tabs/windows on ONE computer, communicating via BroadcastChannel (with
  a localStorage-event fallback for old browsers). Fully offline, zero
  setup, zero configuration.
- **Network Sync (optional)** — Control Panel and Display run on
  DIFFERENT computers on your local network, communicating through a
  small relay server you run on one machine. Still fully offline —
  "network" means your own LAN, not the internet. This is opt-in and
  per-machine; if you never turn it on, nothing about how the app works
  changes.

## Running it (single computer)

This is a static site — any static host works.

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

## Setting up on the day (single computer)

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

## Running it across multiple computers (Network Sync)

Use this when Control Panel and Display need to be on physically
separate machines — e.g. the operator's desk and a TV in a different
room, each with their own computer.

**1. Run the relay server on ONE computer on your network** (it can be
the same machine Control Panel runs on, or a separate one):
```
node server/relay-server.js
```
No `npm install` needed — it has zero dependencies. It'll print the LAN
address(es) to use, e.g. `ws://192.168.1.50:8080`. It needs no internet
access itself; it only relays messages between machines on your LAN.

**2. On EACH machine** (Control Panel's computer AND Display's
computer), enter that address:
- **Control Panel**: open Settings → **Network Sync** (a separate
  section from the main settings, since this is per-machine) → check
  "Enable network sync" → paste the address → Save & Connect.
- **Display**: click the small ⚙ icon in the bottom-left corner → same
  steps.

This has to be set on both machines individually — it can't be pushed
from one to the other, since a machine that isn't connected yet has no
way to receive that broadcast.

**Shortcut for Display**: you can also just open Display with the
server address baked into the URL, e.g.
`display.html?server=ws://192.168.1.50:8080` — handy as a one-time
bookmark on a dedicated display machine, no manual entry needed.

**If a machine joins after tickets have already been called**, it will
automatically ask the other machine for the current ticket and settings
as soon as it connects, so it doesn't start blank.

**Turning it off** on either machine returns that machine to normal
single-computer (BroadcastChannel) behavior immediately.

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
                                   BroadcastChannel/WebSocket. Everything
                                   else talks to this module's
                                   send()/onMessage(). Chooses local vs.
                                   network transport automatically based
                                   on comms.getNetworkConfig().
    state.js                     ← source of truth for the current ticket +
                                   last-5 history, persisted to localStorage.
                                   Also handles cross-MACHINE sync requests
                                   in Network Sync mode.
    speech.js                     ← Speech Synthesis queue (FIFO, no
                                   overlapping announcements)
    settings.js                    ← settings load/save/import/export,
                                   validated + clamped. Also handles
                                   cross-machine settings sync.
    control-panel.js                ← Control Panel page wiring, incl. the
                                   Network Sync settings section
    display.js                       ← Display page wiring, incl. the
                                   minimal Network Sync gear-icon panel

  server/
    relay-server.js                  ← optional WebSocket relay for
                                   Network Sync mode. Zero dependencies
                                   (hand-rolled WebSocket handshake/frames
                                   on Node's built-in http/crypto). Not
                                   needed at all for single-computer use.

  assets/
    bell.mp3                         ← you provide this
    logo-placeholder.png              ← optional fallback logo

  tests/
    (see tests/README.md)             ← Node-based test suite, 147
                                       automated checks total
```

## The one rule that keeps this expandable

Only `comms.js` is allowed to know about the transport (BroadcastChannel
or WebSocket). Every other module calls `send()`/`onMessage()` and
doesn't know or care which one is active underneath.

## Known gaps / possible future work

Not currently built:
- Multi-tab detection warning (if two Control Panel tabs are open at once)
- No-show / skip ticket handling
- CSV export of the running call log (separate from the settings
  export/import that already exists)
- Full ARIA live-region coverage (ticket number and connection status are
  covered; the settings form and history list aren't fully)
- Network Sync has no authentication — anyone who can reach the relay
  server's port on your LAN can connect. Fine for a private local
  network; don't expose the relay server's port to the internet.
