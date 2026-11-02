// Offline tests for the real proxy probe, using fake gateways.
// Run: node --test scripts/proxy-probe.test.mjs
import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import { parseHttpResponse, parseIp, probeThroughGateway } from "../src/lib/server/proxy-probe.ts";

const TOKEN = "t".repeat(40);
const TARGET = new URL("https://echo.example.test/?format=json");

function fakeGateway(handler) {
  return new Promise((resolve) => {
    const sockets = new Set();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
      socket.once("data", (buf) => handler(socket, buf.toString("utf8")));
    });
    server.listen(0, "127.0.0.1", () =>
      resolve({
        endpoint: `127.0.0.1:${server.address().port}`,
        close: () => {
          for (const s of sockets) s.destroy();
          server.close();
        },
      }),
    );
  });
}

test("parses plain and chunked echo responses", () => {
  assert.equal(parseIp('{"ip":"41.0.0.1"}'), "41.0.0.1");
  assert.equal(parseIp("not an ip"), null);
  const chunked = 'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n11\r\n{"ip":"41.0.0.9"}\r\n0\r\n\r\n';
  const r = parseHttpResponse(chunked);
  assert.equal(r.status, 200);
  assert.equal(parseIp(r.body), "41.0.0.9");
});

test("reports a 407 as an authentication failure and sends the session token as proxy credentials", async () => {
  let seen = "";
  const gw = await fakeGateway((socket, request) => {
    seen = request;
    socket.end("HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=x\r\nContent-Length: 0\r\n\r\n");
  });
  const r = await probeThroughGateway(gw.endpoint, TOKEN, TARGET, { timeoutMs: 3000 });
  gw.close();
  assert.equal(r.ok, false);
  assert.equal(r.stage, "proxy_auth");
  assert.match(seen, /^CONNECT echo\.example\.test:443 HTTP\/1\.1/);
  const auth = /proxy-authorization: Basic (\S+)/i.exec(seen)?.[1];
  assert.equal(Buffer.from(auth, "base64").toString(), `session-intent:${TOKEN}`);
  assert.doesNotMatch(JSON.stringify(r), new RegExp(TOKEN), "the token is never echoed in results");
});

test("reports other CONNECT refusals as a tunnel failure, not success", async () => {
  const gw = await fakeGateway((socket) => socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n"));
  const r = await probeThroughGateway(gw.endpoint, TOKEN, TARGET, { timeoutMs: 3000 });
  gw.close();
  assert.deepEqual([r.ok, r.stage], [false, "tunnel"]);
  assert.match(r.message, /502/);
});

test("reports an unreachable gateway", async () => {
  const r = await probeThroughGateway("127.0.0.1:1", TOKEN, TARGET, { timeoutMs: 3000 });
  assert.deepEqual([r.ok, r.stage], [false, "proxy_connect"]);
});

test("times out instead of hanging when the gateway accepts but never answers", async () => {
  const gw = await fakeGateway(() => {});
  const t0 = Date.now();
  const r = await probeThroughGateway(gw.endpoint, TOKEN, TARGET, { timeoutMs: 400 });
  gw.close();
  assert.equal(r.ok, false);
  assert.ok(Date.now() - t0 < 3000);
});

test("does not report success when the 'tunnel' is not a real TLS session with the target", async () => {
  const gw = await fakeGateway((socket) => {
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    // Answer the client's TLS hello with plain text, like a gateway that tunnels to a non-TLS service.
    socket.once("data", () => socket.write("this is not a TLS server\r\n"));
  });
  const r = await probeThroughGateway(gw.endpoint, TOKEN, TARGET, { timeoutMs: 3000 });
  gw.close();
  assert.equal(r.ok, false);
  assert.equal(r.stage, "tls");
});
