import assert from "node:assert/strict";
import dns from "node:dns";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { Duplex } from "node:stream";
import { test } from "node:test";
import { sendWake, setAccountWake } from "../ilink.js";
import { emptyAccount, emptyState, listAccounts, resolveWakeForAccount, saveState } from "../store.js";

const url = "https://api2.cursor.sh/automations/webhook/routine_fixture-1";
const key = "fixture-key";

test("setup validates and saves both wake scopes without probing or returning credentials", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "grok-wechat-wake-test-"));
  const previousHome = process.env.GROK_WECHAT_HOME;
  process.env.GROK_WECHAT_HOME = home;
  t.after(() => {
    if (previousHome === undefined) delete process.env.GROK_WECHAT_HOME;
    else process.env.GROK_WECHAT_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  const noNetwork = () => assert.fail("Wake setup attempted a network call");
  t.mock.method(globalThis, "fetch", noNetwork);
  t.mock.method(https, "request", noNetwork);
  t.mock.method(dns, "lookup", noNetwork);
  saveState({
    ...emptyState(),
    accounts: [{ ...emptyAccount(), ilinkBotId: "bot-fixture", token: "fixture-token" }],
  });

  const result = setAccountWake("bot-fixture", url, key);
  assert.equal(result.global_wake_configured, true);
  assert.equal(result.accounts[0].has_wake, true);
  assert.equal(Object.hasOwn(result, "probe"), false);
  assert.equal(JSON.stringify(result).includes(key), false);
  assert.equal(JSON.stringify(result).includes(url), false);
  assert.throws(() => setAccountWake("bot-fixture", `${url}?`, key), /Grok Bot Routine/);
  assert.throws(() => setAccountWake("bot-fixture", url, "key\r\n"), /webhook 密钥/);
  assert.deepEqual(resolveWakeForAccount(listAccounts()[0]), { url, key });
  assert.deepEqual(resolveWakeForAccount(null), { url, key });
});

test("delivery rejects unsupported stored URLs and invalid keys before I/O", async (t) => {
  t.mock.method(https, "request", () => assert.fail("Invalid wake reached the transport"));
  for (const invalidUrl of [
    url.replace("https:", "http:"),
    url.replace("api2.cursor.sh", "example.invalid"),
    url.replace("api2.cursor.sh", "api2.cursor.sh.example.invalid"),
    url.replace("api2.cursor.sh", "api2.cursor.sh:443"),
    url.replace("api2.cursor.sh", "fixture@api2.cursor.sh"),
    url.replace("/webhook/", "/other/"),
    `${url}/extra`, `${url}?`, `${url}#`, `${url}\n`,
  ]) {
    await assert.rejects(sendWake({ url: invalidUrl, key }, {}), /Grok Bot Routine/);
  }
  await assert.rejects(sendWake({ url, key: "not a bearer token" }, {}), /webhook 密钥/);
});

test("delivery uses one vetted DNS lookup per connection, rejecting mixed and special-use answers", async (t) => {
  const v4 = { address: "8.8.8.8", family: 4 };
  const v6 = { address: "2606:4700::1111", family: 6 };
  let answers = [v4, v6];
  const lookup = t.mock.method(dns, "lookup", (hostname, options, done) => {
    assert.equal(hostname, "api2.cursor.sh");
    assert.deepEqual(options, { all: true });
    done(null, answers);
  });
  t.mock.method(https, "request", (destination, options, respond) => {
    const request = new EventEmitter();
    request.end = () => {
      options.lookup(destination.hostname, { all: true }, (err, addresses) => {
        if (err) request.emit("error", err);
        else {
          assert.deepEqual(addresses, [v4, v6]);
          respond({ statusCode: 200, destroy() {} });
        }
      });
    };
    return request;
  });

  assert.equal(await sendWake({ url, key }, {}), 200);
  for (const [address, family] of [
    ["127.0.0.1", 4], ["10.0.0.1", 4], ["100.64.0.1", 4], ["169.254.1.1", 4],
    ["::1", 6], ["fc00::1", 6], ["fe80::1", 6], ["::ffff:8.8.8.8", 6],
    ["64:ff9b::808:808", 6], ["2002::1", 6],
  ]) {
    answers = [v4, { address, family }];
    await assert.rejects(sendWake({ url, key }, {}), { message: "webhook 请求失败" });
  }
  answers = [];
  await assert.rejects(sendWake({ url, key }, {}), { message: "webhook 请求失败" });
  assert.equal(lookup.mock.callCount(), 12);
});

test("delivery keeps the Bearer POST contract and discards redirect response content", async (t) => {
  const payload = { source: "grok-wechat", count: 1, from_user_ids: ["fixture-peer"] };
  const body = JSON.stringify(payload);
  let written = "";
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, done) {
      written += chunk.toString();
      done();
      if (!written.endsWith(body)) return;
      this.push(Buffer.from(
        "HTTP/1.1 307 Temporary Redirect\r\n"
        + "Location: https://example.invalid/\r\n"
        + "Content-Length: 1000000\r\n\r\n",
      ));
    },
  });
  const transport = t.mock.method(https.Agent.prototype, "createConnection", (options) => {
    assert.equal(options.host, "api2.cursor.sh");
    assert.equal(Number(options.port), 443);
    assert.equal(options.servername, "api2.cursor.sh");
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.maxHeaderSize, 16 * 1024);
    assert.equal(typeof options.lookup, "function");
    return socket;
  });
  assert.equal(await sendWake({ url, key }, payload), 307);
  assert.equal(transport.mock.callCount(), 1);
  assert.equal(socket.destroyed, true);
  const [head, sentBody] = written.split("\r\n\r\n");
  const [requestLine, ...headers] = head.split("\r\n");
  assert.equal(requestLine, "POST /automations/webhook/routine_fixture-1 HTTP/1.1");
  assert.ok(headers.includes("Host: api2.cursor.sh"));
  assert.ok(headers.includes(`Authorization: Bearer ${key}`));
  assert.ok(headers.includes("Content-Type: application/json"));
  assert.ok(headers.includes(`Content-Length: ${Buffer.byteLength(body)}`));
  assert.equal(sentBody, body);
});

test("delivery enforces an overall deadline and returns a redacted error", async (t) => {
  const controller = new AbortController();
  const timeout = t.mock.method(AbortSignal, "timeout", () => controller.signal);
  t.mock.method(https, "request", (_destination, { signal }) => {
    const request = new EventEmitter();
    request.end = () => {
      signal.addEventListener("abort", () => request.emit("error", new Error(`${url} ${key}`)));
      controller.abort();
    };
    return request;
  });
  await assert.rejects(sendWake({ url, key }, {}), { message: "webhook 请求超时" });
  assert.deepEqual(timeout.mock.calls[0].arguments, [5_000]);
});
