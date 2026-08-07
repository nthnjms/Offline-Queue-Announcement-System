/* ==========================================================================
   speech.js — CHUNK 2

   Purpose: wraps the browser Speech Synthesis API with two fixes the raw
   API doesn't give you for free:

     1. Voice-loading race condition — speechSynthesis.getVoices() often
        returns [] on first call because voices load async. This module
        waits for the 'voiceschanged' event once and caches the list.

     2. A real FIFO queue instead of a single isSpeaking flag — if two
        tickets get called in quick succession, announcements queue up
        and play in order rather than the second one getting dropped.

   Will export (Chunk 2 build):
     - announce(text)              -> adds text to the speech queue
     - setRate(value) / setVolume(value)
     - getAvailableEnglishVoices()

   Depends on: nothing (self-contained; testable standalone in console).
   Depended on by: display.js.
   ========================================================================== */

console.log("[speech.js] loaded — Chunk 2 not yet implemented");
