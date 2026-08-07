/* ==========================================================================
   state.js — CHUNK 1

   Purpose: single source of truth for the "current state" of the queue —
   current ticket, current counter, last-5 history — persisted to
   localStorage. This is what makes the Display page correct even if it's
   opened (or refreshed) AFTER a ticket was already called: BroadcastChannel
   messages are fire-and-forget and are missed by pages that weren't open
   yet, so recovery on load always reads from here, not from a broadcast.

   Will export (Chunk 1 build):
     - getState() / setState(partial)
     - subscribe(callback)         -> re-render whenever state changes,
                                       whether the change came from this
                                       tab or a comms.js broadcast
     - pushHistory(entry)          -> maintains the last-5 list

   Depends on: comms.js (to broadcast state changes to the other page).
   Depended on by: control-panel.js, display.js.
   ========================================================================== */

console.log("[state.js] loaded — Chunk 1 not yet implemented");
