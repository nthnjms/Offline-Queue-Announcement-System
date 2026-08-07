/* ==========================================================================
   comms.js — CHUNK 1

   Purpose: the ONLY file in this project that is allowed to know about
   BroadcastChannel (or its localStorage-event fallback). Every other file
   talks to this module, never to BroadcastChannel directly.

   Why that rule matters: when this system eventually grows to support
   multiple computers on a local network (a stated goal of the project),
   BroadcastChannel gets swapped for a local WebSocket connection. If only
   this file touches the transport, that swap is a rewrite of ONE file
   instead of a hunt through control-panel.js and display.js.

   Will export (Chunk 1 build):
     - send(type, payload)        -> broadcast an event to the other page
     - onMessage(type, callback)  -> subscribe to a specific event type
     - startHeartbeat() / onHeartbeat(callback)
                                   -> ping/pong so Control Panel can show
                                      "Display: Connected / Not detected"

   Depends on: nothing (base layer).
   Depended on by: state.js, control-panel.js, display.js.
   ========================================================================== */

console.log("[comms.js] loaded — Chunk 1 not yet implemented");
