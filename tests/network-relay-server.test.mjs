// Real integration test: starts the actual server, connects genuine
// WebSocket clients (Node 22's native WebSocket, same class browsers
// use), and verifies real relay behavior over the real network stack
// (localhost) — not a mock of any kind.

import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, "..", "server/relay-server.js");
const PORT = 8765;

const results = [];
function check(label, condition) {
  results.push({ label, pass: !!condition });
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Start the real server as a child process
const serverProcess = fork(SERVER_PATH, ["--port", String(PORT)], { stdio: "pipe" });
let serverReady = false;
serverProcess.stdout.on("data", (data) => {
  if (data.toString().includes("Listening on port")) serverReady = true;
});
serverProcess.stderr.on("data", (data) => console.error("[server stderr]", data.toString()));

await wait(500);
check("Relay server starts and logs 'Listening on port'", serverReady);

// --- Connect two real clients -----------------------------------------
const clientA = new WebSocket(`ws://localhost:${PORT}`);
const clientB = new WebSocket(`ws://localhost:${PORT}`);

await Promise.all([
  new Promise((resolve) => (clientA.onopen = resolve)),
  new Promise((resolve) => (clientB.onopen = resolve)),
]);
check("Two real WebSocket clients both connect successfully", clientA.readyState === WebSocket.OPEN && clientB.readyState === WebSocket.OPEN);

// --- Basic relay: A sends, B receives ------------------------------------
let bReceived = null;
clientB.onmessage = (event) => (bReceived = JSON.parse(event.data));
clientA.send(JSON.stringify({ type: "ticket-called", payload: { ticketNumber: "B015", counter: 2 }, ts: Date.now() }));
await wait(100);
check("Client B receives what Client A sent", bReceived?.type === "ticket-called" && bReceived?.payload?.ticketNumber === "B015");

// --- Self-exclusion: A should NOT receive its own message ---------------
let aReceivedOwnMessage = false;
clientA.onmessage = () => (aReceivedOwnMessage = true);
clientA.send(JSON.stringify({ type: "ping", payload: {}, ts: Date.now() }));
await wait(100);
check("Sender does not receive its own broadcast (matches BroadcastChannel semantics)", !aReceivedOwnMessage);

// --- Reverse direction: B sends, A receives ------------------------------
let aReceived = null;
clientA.onmessage = (event) => (aReceived = JSON.parse(event.data));
clientB.send(JSON.stringify({ type: "settings-sync", payload: { officeName: "CNU Registrar" }, ts: Date.now() }));
await wait(100);
check("Relay works in both directions", aReceived?.payload?.officeName === "CNU Registrar");

// --- Larger payload: exercises the 126+ extended-length frame path -------
// (e.g. a settings-sync carrying a base64 logo)
const largePayload = { officeName: "Test", officeLogo: "data:image/png;base64," + "A".repeat(5000) };
let bReceivedLarge = null;
clientB.onmessage = (event) => (bReceivedLarge = JSON.parse(event.data));
clientA.send(JSON.stringify({ type: "settings-sync", payload: largePayload, ts: Date.now() }));
await wait(150);
check(
  "Large payload (5000+ chars, exercises extended frame length encoding) relays correctly and intact",
  bReceivedLarge?.payload?.officeLogo === largePayload.officeLogo
);

// --- A third client joining later also gets relayed messages -------------
const clientC = new WebSocket(`ws://localhost:${PORT}`);
await new Promise((resolve) => (clientC.onopen = resolve));
let cReceived = null;
clientC.onmessage = (event) => (cReceived = JSON.parse(event.data));
clientA.send(JSON.stringify({ type: "ticket-repeat", payload: { ticketNumber: "A004" }, ts: Date.now() }));
await wait(100);
check("A newly-connected third client also receives relayed messages", cReceived?.type === "ticket-repeat");

// --- Disconnection is handled cleanly -------------------------------------
clientC.close();
await wait(100);
let bStillWorks = null;
clientB.onmessage = (event) => (bStillWorks = JSON.parse(event.data));
clientA.send(JSON.stringify({ type: "display-cleared", payload: {}, ts: Date.now() }));
await wait(100);
check("Remaining clients keep working normally after another client disconnects", bStillWorks?.type === "display-cleared");

// --- Cleanup ---------------------------------------------------------------
clientA.close();
clientB.close();
serverProcess.kill();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length > 0 ? 1 : 0);
