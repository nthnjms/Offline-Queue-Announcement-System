// Test harness v2.
//
// v1 had a false-negative: it imported state.js twice under different
// query strings to simulate two tabs, but state.js's OWN internal
// `import "./comms.js"` (no query string) always resolves to the exact
// same cached module in Node — so both "tabs" secretly shared one
// BroadcastChannel object, which (correctly, per spec) never delivers a
// message back to the very channel object that sent it. That's a
// Node module-caching quirk, not a real-browser condition: two actual
// browser tabs have fully separate JS realms, so this collapse can't
// happen there. Real cross-tab delivery is still verified below —
// via genuinely separate comms.js instances — same as it would be
// verified from two real tabs.

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = globalThis;

const results = [];
function check(label, condition) {
  results.push({ label, pass: !!condition });
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------
// PART A — comms.js: verify genuinely separate instances (= real tabs)
// exchange messages correctly, in both directions, including heartbeat.
// ---------------------------------------------------------------------
const commsA = await import("../js/comms.js?realm=A");
const commsB = await import("../js/comms.js?realm=B");

let bHeard = null;
commsB.onMessage("hello", (payload) => (bHeard = payload));
commsA.send("hello", { from: "A" });
await wait(50);
check("comms.js: separate instance B receives A's broadcast", bHeard?.from === "A");

let aHeard = null;
commsA.onMessage("hello-back", (payload) => (aHeard = payload));
commsB.send("hello-back", { from: "B" });
await wait(50);
check("comms.js: separate instance A receives B's broadcast", aHeard?.from === "B");

// Heartbeat: set up the LISTENER before the sender starts, exactly like
// production (Display page loads, THEN Control Panel starts watching).
let connectionStatus = null;
const stopHeartbeat = commsA.onHeartbeat((connected) => (connectionStatus = connected));
commsB.startHeartbeat();
await wait(1200); // > the 1000ms status-check interval
check("comms.js: Control Panel detects Display as connected", connectionStatus === true);
stopHeartbeat();

// ---------------------------------------------------------------------
// PART B — state.js: business logic correctness for a SINGLE page,
// verifying both local state changes and the exact events it broadcasts
// out (captured by an independent spy channel — i.e. "what would the
// other real tab actually receive").
// ---------------------------------------------------------------------
const spy = await import("../js/comms.js?realm=spy");
const page = await import("../js/state.js?realm=page"); // its internal comms.js is a 3rd, separate instance from spy

const spyReceived = [];
spy.onMessage("ticket-called", (p) => spyReceived.push(["ticket-called", p]));
spy.onMessage("ticket-repeat", (p) => spyReceived.push(["ticket-repeat", p]));
spy.onMessage("display-cleared", (p) => spyReceived.push(["display-cleared", p]));

page.callTicket({ ticketNumber: "b015", counter: 2, message: "" });
await wait(50);

check("state.js: ticket number normalized to uppercase", page.getState().current?.ticketNumber === "B015");
check("state.js: broadcasts 'ticket-called' with correct payload", spyReceived[0]?.[0] === "ticket-called" && spyReceived[0][1].ticketNumber === "B015");
check("state.js: persists to localStorage immediately", JSON.parse(localStorage.getItem("queue-system:state")).current.ticketNumber === "B015");

page.callTicket({ ticketNumber: "a001", counter: 1 });
page.callTicket({ ticketNumber: "a002", counter: 1 });
page.callTicket({ ticketNumber: "a003", counter: 1 });
page.callTicket({ ticketNumber: "a004", counter: 1 });
await wait(50);
const hist = page.getState().history;
check("state.js: history capped at 5 entries", hist.length === 5);
check("state.js: history is newest-first", hist[0].ticketNumber === "A004");

const histLenBefore = page.getState().history.length;
page.repeatCurrent();
await wait(50);
check("state.js: repeat does not add a new history entry", page.getState().history.length === histLenBefore);
check("state.js: repeat broadcasts 'ticket-repeat' (not 'ticket-called')", spyReceived.at(-1)[0] === "ticket-repeat");

page.clearDisplay();
await wait(50);
check("state.js: clearDisplay sets current to null locally", page.getState().current === null);
check("state.js: clearDisplay preserves history", page.getState().history.length === histLenBefore);
check("state.js: clearDisplay broadcasts 'display-cleared'", spyReceived.at(-1)[0] === "display-cleared");

// ---------------------------------------------------------------------
// PART C — recovery on load: a page opened/refreshed AFTER data existed
// in localStorage should see it immediately, with no broadcast needed.
// This is the exact "Display opened after a ticket was called" case.
// ---------------------------------------------------------------------
const latePage = await import("../js/state.js?realm=late-open");
check(
  "state.js: freshly-opened page recovers persisted state (current is null after clear)",
  latePage.getState().current === null
);
check(
  "state.js: freshly-opened page recovers persisted history",
  latePage.getState().history.length === histLenBefore
);

// ---------------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length > 0 ? 1 : 0);
