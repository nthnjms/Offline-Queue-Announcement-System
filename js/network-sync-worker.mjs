// Simulates ONE real machine on the network: its own process, its own
// isolated localStorage, its own fresh import of the actual project
// files. This is run as a genuinely separate OS process (via fork), so
// there's no possibility of state leaking between "machines" the way
// there would be if this were faked within a single process.

import path from "node:path";

const PROJECT_DIR = process.env.PROJECT_DIR;
const PORT = process.env.PORT;
const ROLE = process.env.ROLE; // "control" or "display"

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = { location: { search: "" } };

const comms = await import(path.join(PROJECT_DIR, "js/comms.js"));
const state = await import(path.join(PROJECT_DIR, "js/state.js"));
const settings = await import(path.join(PROJECT_DIR, "js/settings.js"));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

comms.setNetworkConfig({ enabled: true, serverUrl: `ws://localhost:${PORT}` });

// wait for the WebSocket to actually connect
await new Promise((resolve) => comms.onTransportReady(resolve));

if (ROLE === "control") {
  // Simulate the operator calling a ticket and changing settings BEFORE
  // any Display machine has connected — this is the scenario that
  // matters: does a machine joining LATER correctly recover this?
  state.callTicket({ ticketNumber: "b015", counter: 2, message: "" });
  settings.saveSettings({ officeName: "Cebu Normal University", counterCount: 6 });

  process.send({ ready: true });

  // Stay alive to answer the display machine's request-sync
  await wait(3000);
  process.exit(0);
} else if (ROLE === "display") {
  // Give the sync round-trip time to complete after connecting
  await wait(600);

  process.send({
    recoveredTicket: state.getState().current,
    recoveredHistoryLength: state.getState().history.length,
    recoveredOfficeName: settings.getSettings().officeName,
    recoveredCounterCount: settings.getSettings().counterCount,
  });
  process.exit(0);
}
