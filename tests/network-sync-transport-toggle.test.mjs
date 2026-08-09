// Regression test for a real bug: a page that STARTS in network mode
// never initializes the local (BroadcastChannel) transport at all —
// only network mode does. Switching back to local mode later needs to
// actually set up that local transport for the first time, not just
// assume it's already sitting there ready (it never was). Without the
// fix, this test fails: send() silently does nothing after switching
// back, because neither transport is actually active.

const results = [];
function check(label, condition) {
  results.push({ label, pass: !!condition });
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = globalThis;

// Import the spy FIRST, while localStorage still has no network config —
// this represents a real, uninvolved second tab that was never pointed
// at network mode. If we imported it AFTER setting network-config to
// enabled:true below, the spy would ALSO read that shared config at ITS
// own module-load time and start in the same broken state we're testing
// the fix for — which would test nothing.
const spy = await import("../js/comms.js?toggle-test-spy");

// NOW simulate a page that starts in network mode — e.g. a machine that
// was configured for Network Sync in a previous session.
store.set(
  "queue-system:network-config",
  JSON.stringify({ enabled: true, serverUrl: "ws://localhost:19998" }) // unreachable on purpose — we don't need it to succeed
);

const pageUnderTest = await import("../js/comms.js?toggle-test");
await wait(100); // let the doomed connection attempt fail/settle

let spyReceivedBeforeSwitch = null;
spy.onMessage("ticket-called", (payload) => (spyReceivedBeforeSwitch = payload));
pageUnderTest.send("ticket-called", { ticketNumber: "SHOULD-NOT-ARRIVE", counter: 1 });
await wait(50);
check(
  "Sanity check: while still in (doomed) network mode, a local spy correctly does NOT receive the message",
  spyReceivedBeforeSwitch === null
);

// --- The actual fix under test: switch back to single-computer mode ---
const applied = pageUnderTest.setNetworkConfig({ enabled: false, serverUrl: "" });
check("setNetworkConfig reports network sync is now off", applied.enabled === false);

let spyReceivedAfterSwitch = null;
spy.onMessage("ticket-called", (payload) => (spyReceivedAfterSwitch = payload));
pageUnderTest.send("ticket-called", { ticketNumber: "B015", counter: 2 });
await wait(50);

check(
  "THE FIX: after switching back to local mode, messages actually get delivered again (not silently dropped)",
  spyReceivedAfterSwitch?.ticketNumber === "B015"
);

// --- Also verify toggling back and forth repeatedly doesn't break anything ---
pageUnderTest.setNetworkConfig({ enabled: true, serverUrl: "ws://localhost:19998" });
await wait(50);
pageUnderTest.setNetworkConfig({ enabled: false, serverUrl: "" });
await wait(50);

let spyReceivedAfterMultipleToggles = null;
spy.onMessage("ticket-called", (payload) => (spyReceivedAfterMultipleToggles = payload));
pageUnderTest.send("ticket-called", { ticketNumber: "A004", counter: 3 });
await wait(50);
check(
  "Still works correctly after multiple on/off toggles (no duplicate channels, no leaks)",
  spyReceivedAfterMultipleToggles?.ticketNumber === "A004"
);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length > 0 ? 1 : 0);
