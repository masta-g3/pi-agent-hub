import test from "node:test";
import assert from "node:assert/strict";
import { readServeStatus, servedAddress } from "../src/core/tailscale-serve.js";

// The shape `tailscale serve status --json` prints for `tailscale serve --bg 4747`.
const served = (host: string, servePort: number, proxy: string, path = "/", https = true) => ({
  TCP: { [String(servePort)]: https ? { HTTPS: true } : { HTTP: true } },
  Web: { [`${host}:${servePort}`]: { Handlers: { [path]: { Proxy: proxy } } } },
});

test("an HTTPS root mount proxying the inbox port is the phone address", () => {
  assert.equal(servedAddress(served("rpotec-mini.taila4d4da.ts.net", 443, "http://127.0.0.1:4747"), 4747), "https://rpotec-mini.taila4d4da.ts.net");
  assert.equal(servedAddress(served("mac.tail1.ts.net", 8443, "http://localhost:4747/"), 4747), "https://mac.tail1.ts.net:8443");
});

test("other mounts, ports, schemes and shapes are not published", () => {
  const host = "mac.tail1.ts.net";
  for (const status of [
    served(host, 443, "http://127.0.0.1:4747", "/inbox"),
    served(host, 443, "http://127.0.0.1:4747", "/", false),
    served(host, 443, "http://127.0.0.1:4800"),
    served(host, 443, "https+insecure://127.0.0.1:4747"),
    served(host, 443, "http://127.0.0.1:47470"),
    served("evil.example.com", 443, "http://127.0.0.1:4747"),
    served("mac.tail1.ts.net\u001b[2J", 443, "http://127.0.0.1:4747"),
    served("ts.net", 443, "http://127.0.0.1:4747"),
    served(host, 70000, "http://127.0.0.1:4747"),
    { Web: "nope" },
    { TCP: { 443: { HTTPS: true } }, Web: { [`${host}:443`]: { Handlers: { "/": { Proxy: 4747 } } } } },
    {},
    undefined,
    null,
  ]) assert.equal(servedAddress(status, 4747), undefined, JSON.stringify(status));
});

test("several published hosts pick the first by name", () => {
  const status = {
    TCP: { 443: { HTTPS: true } },
    Web: {
      "z.tail1.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:4747" } } },
      "a.tail1.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:4747" } } },
    },
  };
  assert.equal(servedAddress(status, 4747), "https://a.tail1.ts.net");
});

test("reading the status parses stdout only and treats a failure as no status", async () => {
  const calls: string[][] = [];
  const status = await readServeStatus({ async exec(command, args) {
    calls.push([command, ...args]);
    return { stdout: JSON.stringify({ Web: {} }), stderr: "Warning: client version != tailscaled server version" };
  } });
  assert.deepEqual(status, { Web: {} });
  assert.deepEqual(calls, [["tailscale", "serve", "status", "--json"]]);
  assert.equal(await readServeStatus({ async exec() { throw new Error("tailscale: command not found"); } }), undefined);
  assert.equal(await readServeStatus({ async exec() { return { stdout: "No serve config\n", stderr: "" }; } }), undefined);
});
