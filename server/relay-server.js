#!/usr/bin/env node
/* ==========================================================================
   relay-server.js — Network Sync relay server (optional, multi-computer)

   A tiny WebSocket relay: whatever one connected browser sends, every
   OTHER connected browser receives — nothing more. It doesn't understand
   ticket numbers, doesn't store history, doesn't know anything about the
   queue app at all. All of that logic already lives in the browser
   (comms.js / state.js / settings.js); this just passes bytes between
   machines on your local network.

   ZERO DEPENDENCIES — built entirely on Node's built-in `http`, `crypto`,
   and `net` modules, including a hand-rolled WebSocket handshake and
   frame parser (RFC 6455). No `npm install` needed. This matters because
   the whole point of this project is to run with nothing but what's
   already on the machine — requiring a dependency just for the optional
   networked mode would undercut that.

   USAGE
     node server/relay-server.js
     node server/relay-server.js --port 9000

   Run this on ONE computer on your local network (it can be the same
   computer Control Panel runs on, or a separate one). Then point both
   Control Panel and Display at it — see the Network Sync section in
   Control Panel's Settings — using the LAN address this prints on
   startup, e.g. ws://192.168.1.50:8080

   This server needs no internet access and makes none — it only listens
   on your local network. Stopping it (Ctrl+C) simply drops back to
   whatever each browser's local/offline mode was already doing.
   ========================================================================== */

const http = require("node:http");
const crypto = require("node:crypto");
const os = require("node:os");

const PORT = getPortFromArgs() || Number(process.env.PORT) || 8080;
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"; // fixed per RFC 6455

function getPortFromArgs() {
  const flagIndex = process.argv.indexOf("--port");
  if (flagIndex === -1) return null;
  const value = Number(process.argv[flagIndex + 1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** All currently-connected raw sockets (post-handshake). */
const clients = new Set();

// --- HTTP server, upgraded to WebSocket on request -------------------------

const server = http.createServer((req, res) => {
  // Not a webpage — just a friendly response if someone opens the port
  // in a regular browser tab instead of connecting via WebSocket.
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end(
    "Queue Announcement System — Network Sync relay is running.\n" +
      `Connected clients: ${clients.size}\n`
  );
});

server.on("upgrade", (req, socket, head) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash("sha1")
    .update(key + WEBSOCKET_GUID)
    .digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
      "\r\n"
  );

  clients.add(socket);
  console.log(`[relay-server] Client connected (${clients.size} total)`);

  let buffer = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    buffer = processFrames(socket, buffer);
  });

  socket.on("close", () => {
    clients.delete(socket);
    console.log(`[relay-server] Client disconnected (${clients.size} total)`);
  });

  socket.on("error", (err) => {
    console.warn("[relay-server] Socket error:", err.message);
    clients.delete(socket);
  });
});

// --- Minimal WebSocket frame parsing (RFC 6455) ----------------------------
// Handles single-frame text messages only (opcode 0x1), which is all this
// app ever sends — our JSON payloads are small and never fragmented.
// Browser-sent frames are always masked; we unmask, relay the decoded
// text to every OTHER connected client, and re-frame it (unmasked, as
// required for server-to-client frames) on the way out.

function processFrames(socket, buffer) {
  while (buffer.length >= 2) {
    const secondByte = buffer[1];
    const masked = Boolean(secondByte & 0x80);
    let payloadLength = secondByte & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
      if (buffer.length < offset + 2) return buffer; // wait for more data
      payloadLength = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLength === 127) {
      if (buffer.length < offset + 8) return buffer;
      payloadLength = Number(buffer.readBigUInt64BE(offset));
      offset += 8;
    }

    const opcode = buffer[0] & 0x0f;

    if (opcode === 0x8) {
      // Close frame
      socket.end();
      return Buffer.alloc(0);
    }

    let maskKey = null;
    if (masked) {
      if (buffer.length < offset + 4) return buffer;
      maskKey = buffer.subarray(offset, offset + 4);
      offset += 4;
    }

    if (buffer.length < offset + payloadLength) return buffer; // wait for more data

    let payload = buffer.subarray(offset, offset + payloadLength);
    if (masked) {
      payload = Buffer.from(payload); // copy before mutating
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= maskKey[i % 4];
      }
    }

    if (opcode === 0x1) {
      const text = payload.toString("utf8");
      relayToOthers(socket, text);
    }
    // opcode 0x9 (ping) / 0xA (pong) are simply ignored — no keepalive
    // logic needed for this app's message volume.

    buffer = buffer.subarray(offset + payloadLength);
  }
  return buffer;
}

function relayToOthers(sender, text) {
  const frame = encodeTextFrame(text);
  clients.forEach((client) => {
    if (client !== sender && client.writable) {
      client.write(frame);
    }
  });
}

function encodeTextFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const length = payload.length;

  let header;
  if (length < 126) {
    header = Buffer.from([0x81, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, payload]);
}

// --- Startup ---------------------------------------------------------------

function getLocalNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

server.listen(PORT, () => {
  console.log(`[relay-server] Listening on port ${PORT}`);
  console.log("[relay-server] Point Control Panel and Display at one of these addresses:");
  const addresses = getLocalNetworkAddresses();
  if (addresses.length === 0) {
    console.log(`  ws://localhost:${PORT}  (same computer only — no network address detected)`);
  } else {
    addresses.forEach((addr) => console.log(`  ws://${addr}:${PORT}`));
  }
  console.log("[relay-server] Press Ctrl+C to stop.");
});

module.exports = { server, PORT };
