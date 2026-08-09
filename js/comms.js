/* ==========================================================================
   comms.js — CHUNK 1 (implemented) + Network Sync (multi-computer, optional)

   The ONLY file in this project allowed to know about BroadcastChannel,
   WebSocket, or the localStorage fallback. Every other file talks to
   THIS module's send()/onMessage() functions — never to a transport
   directly. That rule is what makes multi-computer support a one-file
   change instead of a rewrite.

   TWO TRANSPORTS, chosen automatically by config:

   1. LOCAL (default, zero-config, fully offline) — BroadcastChannel,
      falling back to localStorage events on old browsers. Works only
      between tabs on the SAME computer. This is completely unchanged
      from the single-computer version — if network sync is never
      turned on, this file behaves exactly as before.

   2. NETWORK (opt-in) — a plain WebSocket connection to a small relay
      server (see server/relay-server.js) running on ONE computer on
      your local network. This lets Control Panel and Display run on
      DIFFERENT computers, while staying fully offline from the
      internet — "network" here means your own LAN, not the internet.
      The relay server has no dependencies and needs no internet
      access either; it's just a message relay.

   Network config (enabled + server URL) is deliberately NOT part of
   settings.js's synced settings — it can't be, since a machine that
   isn't connected yet has no way to receive a broadcast telling it how
   to connect. It's stored per-machine in its own localStorage key, and
   can also be set via a URL query param (?server=ws://192.168.1.50:8080)
   for one-click setup on a display machine, e.g. as a bookmark.

   Also exports onTransportReady(callback) — fires once the transport is
   usable (immediately for local mode; on WebSocket open, and again on
   every reconnect, for network mode). state.js/settings.js use this to
   request a fresh state/settings sync from other machines after
   connecting — see their "Cross-tab/cross-machine sync" sections.
   ========================================================================== */

const CHANNEL_NAME = "queue-system";
const FALLBACK_STORAGE_KEY = "queue-system:comms-fallback";
const NETWORK_CONFIG_KEY = "queue-system:network-config";

const HEARTBEAT_INTERVAL_MS = 3000;
const HEARTBEAT_TIMEOUT_MS = 7000; // no pulse within this window = "disconnected"
const WS_RECONNECT_DELAY_MS = 3000;

// type -> Set<callback>
const listeners = new Map();

let channel = null; // local mode: BroadcastChannel
let usingFallback = false; // local mode: localStorage-event fallback
let ws = null; // network mode: WebSocket
let wsReconnectTimer = null;

let transportIsReady = false;
const transportReadyCallbacks = new Set();
const transportStatusCallbacks = new Set();

/** True if this browser supports BroadcastChannel. Old Safari doesn't. */
function supportsBroadcastChannel() {
  return typeof BroadcastChannel !== "undefined";
}

function dispatch(message) {
  if (!message || typeof message.type !== "string") return;
  const callbacks = listeners.get(message.type);
  if (!callbacks || callbacks.size === 0) return;
  callbacks.forEach((callback) => {
    try {
      callback(message.payload, message);
    } catch (err) {
      console.error(`[comms.js] listener for "${message.type}" threw:`, err);
    }
  });
}

function setTransportStatus(isReady) {
  transportIsReady = isReady;
  if (isReady) {
    transportReadyCallbacks.forEach((callback) => {
      try {
        callback();
      } catch (err) {
        console.error("[comms.js] onTransportReady callback threw:", err);
      }
    });
  }
  transportStatusCallbacks.forEach((callback) => {
    try {
      callback(isReady);
    } catch (err) {
      console.error("[comms.js] onTransportStatusChange callback threw:", err);
    }
  });
}

// --- Network config (per-machine, not synced — see file header) -----------

function readNetworkConfigFromURL() {
  // Use window.location explicitly rather than the bare `location` global —
  // in a real browser they're identical, but this also makes the function
  // work correctly in a Node test harness where only `window` is mocked.
  if (typeof window === "undefined" || !window.location) return null;
  const params = new URLSearchParams(window.location.search);
  const server = params.get("server");
  if (!server) return null;
  return { enabled: true, serverUrl: server };
}

/** Current network sync config: { enabled, serverUrl }. Checks the URL
 *  query param first (and persists it if present, so a one-time bookmarked
 *  link is remembered on future loads without the param), then falls back
 *  to whatever was previously saved, then defaults to local-only mode. */
export function getNetworkConfig() {
  const fromURL = readNetworkConfigFromURL();
  if (fromURL) {
    try {
      localStorage.setItem(NETWORK_CONFIG_KEY, JSON.stringify(fromURL));
    } catch (err) {
      console.error("[comms.js] Failed to persist network config from URL:", err);
    }
    return fromURL;
  }
  try {
    const raw = localStorage.getItem(NETWORK_CONFIG_KEY);
    if (!raw) return { enabled: false, serverUrl: "" };
    const parsed = JSON.parse(raw);
    return {
      enabled: Boolean(parsed?.enabled),
      serverUrl: typeof parsed?.serverUrl === "string" ? parsed.serverUrl : "",
    };
  } catch (err) {
    console.error("[comms.js] Failed to load network config, defaulting to local-only:", err);
    return { enabled: false, serverUrl: "" };
  }
}

/**
 * Turn network sync on/off, or change the server URL. Tears down whatever
 * transport is currently active and (re)connects. Call this from a
 * Settings-style UI on EACH machine — it must be set individually per
 * machine, not synced (see file header).
 * @param {{ enabled: boolean, serverUrl: string }} config
 * @returns {{ enabled: boolean, serverUrl: string }} the config actually applied
 */
export function setNetworkConfig({ enabled, serverUrl }) {
  const trimmedUrl = typeof serverUrl === "string" ? serverUrl.trim() : "";
  const urlLooksValid = /^wss?:\/\/.+/i.test(trimmedUrl);
  const config = { enabled: Boolean(enabled) && urlLooksValid, serverUrl: trimmedUrl };

  try {
    localStorage.setItem(NETWORK_CONFIG_KEY, JSON.stringify(config));
  } catch (err) {
    console.error("[comms.js] Failed to save network config:", err);
  }

  teardownNetworkTransport();
  setTransportStatus(false);

  if (config.enabled) {
    connectWebSocket(config.serverUrl);
  } else {
    // Local mode was already initialized at module load (see init() at
    // the bottom of this file) — BroadcastChannel/fallback is still
    // sitting there ready to go, so just mark ready again.
    setTransportStatus(true);
  }

  return config;
}

function teardownNetworkTransport() {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  if (ws) {
    try {
      ws.close();
    } catch (err) {
      /* already closing/closed — nothing to do */
    }
    ws = null;
  }
}

function connectWebSocket(url) {
  let socket;
  try {
    socket = new WebSocket(url);
  } catch (err) {
    console.error("[comms.js] Invalid network sync server address:", url, err);
    scheduleReconnect(url);
    return;
  }
  ws = socket;

  socket.addEventListener("open", () => {
    console.log("[comms.js] Network sync connected:", url);
    setTransportStatus(true);
  });

  socket.addEventListener("message", (event) => {
    try {
      dispatch(JSON.parse(event.data));
    } catch (err) {
      console.error("[comms.js] Failed to parse network sync message:", err);
    }
  });

  socket.addEventListener("close", () => {
    if (ws === socket) ws = null;
    setTransportStatus(false);
    scheduleReconnect(url);
  });

  socket.addEventListener("error", (err) => {
    console.warn("[comms.js] Network sync connection error:", err);
  });
}

function scheduleReconnect(url) {
  if (wsReconnectTimer) return;
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    // Only reconnect if network mode is still on and still pointed at
    // this same URL — avoids a stale timer reviving a connection the
    // operator has since turned off or repointed elsewhere.
    const current = getNetworkConfig();
    if (current.enabled && current.serverUrl === url) connectWebSocket(url);
  }, WS_RECONNECT_DELAY_MS);
}

// --- Local transport (unchanged from the single-computer version) --------

function initLocalTransport() {
  if (supportsBroadcastChannel()) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener("message", (event) => dispatch(event.data));
    return;
  }

  // Fallback: use the native 'storage' event, which only fires in OTHER
  // tabs (never the tab that wrote the value) — the same "not delivered
  // to sender" semantics as BroadcastChannel, so callers don't need to
  // special-case either transport.
  usingFallback = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== FALLBACK_STORAGE_KEY || !event.newValue) return;
    try {
      dispatch(JSON.parse(event.newValue));
    } catch (err) {
      console.error("[comms.js] Failed to parse fallback message:", err);
    }
  });
  console.warn(
    "[comms.js] BroadcastChannel not supported in this browser — " +
      "falling back to localStorage events. Functionality is the same, " +
      "but slightly higher latency."
  );
}

/**
 * Broadcast an event to the other page(s) — same machine (local mode) or
 * other machines on the network (network mode), whichever is active.
 * @param {string} type - event name, e.g. "ticket-called"
 * @param {object} [payload] - JSON-serializable data for the event
 */
export function send(type, payload = {}) {
  const message = { type, payload, ts: Date.now() };
  const networkConfig = getNetworkConfig();

  if (networkConfig.enabled) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    } else {
      console.warn(`[comms.js] Network sync not connected yet — "${type}" was not sent.`);
    }
    return;
  }

  if (channel) {
    channel.postMessage(message);
    return;
  }

  if (usingFallback) {
    try {
      localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(message));
    } catch (err) {
      console.error("[comms.js] Fallback send failed:", err);
    }
  }
}

/**
 * Subscribe to a specific event type.
 * @param {string} type - event name to listen for
 * @param {(payload: object, message: object) => void} callback
 * @returns {() => void} unsubscribe function
 */
export function onMessage(type, callback) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(callback);
  return () => listeners.get(type)?.delete(callback);
}

/**
 * Fires once the transport is actually usable — immediately, for local
 * mode (BroadcastChannel is always "ready"); on WebSocket open, and again
 * after every reconnect, for network mode. Fires immediately if the
 * transport is already ready by the time you subscribe (matches the
 * subscribe() pattern used in state.js/settings.js).
 * @param {() => void} callback
 * @returns {() => void} unsubscribe function
 */
export function onTransportReady(callback) {
  transportReadyCallbacks.add(callback);
  if (transportIsReady) callback();
  return () => transportReadyCallbacks.delete(callback);
}

/**
 * Fires with the current connection status immediately, and again every
 * time it changes in either direction — connected AND disconnected.
 * Meant for a UI status indicator (e.g. the Network Sync connection dot);
 * onTransportReady() above is for one-shot "do a sync request" logic.
 * @param {(isReady: boolean) => void} callback
 * @returns {() => void} unsubscribe function
 */
export function onTransportStatusChange(callback) {
  transportStatusCallbacks.add(callback);
  callback(transportIsReady);
  return () => transportStatusCallbacks.delete(callback);
}

/**
 * Call this once from display.js on page load. Makes this page announce
 * its presence on an interval, and reply immediately if a Control Panel
 * asks "are you there?" via a 'ping' event.
 */
export function startHeartbeat() {
  send("display-heartbeat", {});
  setInterval(() => send("display-heartbeat", {}), HEARTBEAT_INTERVAL_MS);
  onMessage("ping", () => send("display-heartbeat", {}));
}

/**
 * Call this once from control-panel.js. Reports connection status
 * whenever it changes (not on every check) so the UI doesn't re-render
 * needlessly.
 * @param {(connected: boolean) => void} callback
 * @returns {() => void} stop function
 */
export function onHeartbeat(callback) {
  let lastSeen = 0;
  let lastReportedStatus = null;

  onMessage("display-heartbeat", () => {
    lastSeen = Date.now();
  });

  function checkStatus() {
    const connected = Date.now() - lastSeen < HEARTBEAT_TIMEOUT_MS;
    if (connected !== lastReportedStatus) {
      lastReportedStatus = connected;
      callback(connected);
    }
  }

  // Ask any already-open Display page to identify itself right away,
  // instead of waiting up to HEARTBEAT_INTERVAL_MS for its next pulse.
  send("ping", {});

  const intervalId = setInterval(checkStatus, 1000);
  checkStatus();

  return () => clearInterval(intervalId);
}

// --- Startup ---------------------------------------------------------------

function init() {
  const networkConfig = getNetworkConfig();
  if (networkConfig.enabled) {
    connectWebSocket(networkConfig.serverUrl);
  } else {
    initLocalTransport();
    setTransportStatus(true);
  }
}

init();

// Expose on window for manual testing in the browser console. Safe to
// leave in — costs nothing in production and helps anyone debugging later.
if (typeof window !== "undefined") {
  window.__queueComms = {
    send,
    onMessage,
    startHeartbeat,
    onHeartbeat,
    onTransportReady,
    onTransportStatusChange,
    getNetworkConfig,
    setNetworkConfig,
  };
}

console.log(
  `[comms.js] ready (transport: ${
    getNetworkConfig().enabled ? "network sync" : usingFallback ? "localStorage fallback" : "BroadcastChannel"
  })`
);
