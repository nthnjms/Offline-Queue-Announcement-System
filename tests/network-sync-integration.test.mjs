import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, "..");
const SERVER_PATH = path.join(PROJECT_DIR, "server/relay-server.js");
const WORKER_PATH = path.join(__dirname, "network-sync-worker.mjs");
const PORT = 8766;

const results = [];
function check(label, condition) {
  results.push({ label, pass: !!condition });
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Start the real relay server -------------------------------------------
const server = fork(SERVER_PATH, ["--port", String(PORT)], { stdio: "pipe" });
let serverReady = false;
server.stdout.on("data", (d) => {
  if (d.toString().includes("Listening on port")) serverReady = true;
});
await wait(500);
check("Relay server started", serverReady);

// --- "Machine A" (Control Panel): calls a ticket + saves settings BEFORE
// any display machine connects -----------------------------------------
const controlMachine = fork(WORKER_PATH, {
  env: { ...process.env, PROJECT_DIR, PORT: String(PORT), ROLE: "control" },
});

const controlReady = await new Promise((resolve) => {
  controlMachine.on("message", (msg) => {
    if (msg.ready) resolve(true);
  });
  setTimeout(() => resolve(false), 3000);
});
check("Control machine connected, called a ticket, and saved settings", controlReady);

// --- "Machine B" (Display): connects AFTER the fact — this is the whole
// point of the feature: does it recover state it never directly saw? ----
const displayMachine = fork(WORKER_PATH, {
  env: { ...process.env, PROJECT_DIR, PORT: String(PORT), ROLE: "display" },
});

const displayResult = await new Promise((resolve) => {
  displayMachine.on("message", (msg) => resolve(msg));
  setTimeout(() => resolve(null), 5000);
});

check(
  "A machine connecting AFTER the fact recovers the ticket it never directly saw",
  displayResult?.recoveredTicket?.ticketNumber === "B015"
);
check(
  "Recovered ticket has the correct counter",
  displayResult?.recoveredTicket?.counter === 2
);
check(
  "History was also recovered (not just the current ticket)",
  displayResult?.recoveredHistoryLength === 1
);
check(
  "Settings were also recovered across machines",
  displayResult?.recoveredOfficeName === "Cebu Normal University" &&
    displayResult?.recoveredCounterCount === 6
);

// --- Cleanup -----------------------------------------------------------
controlMachine.kill();
displayMachine.kill();
server.kill();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length > 0 ? 1 : 0);
