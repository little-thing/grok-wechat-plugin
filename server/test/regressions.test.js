// node --test server/test  （零依赖，Node >= 20）
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "grok-wechat-test-"));
process.env.GROK_WECHAT_HOME = HOME;

const store = await import("../store.js");
const { safeMediaName, mediaFilePath } = await import("../ilink.js");

const INDEX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "index.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("入站文件名不能写出 media 目录", () => {
  for (const name of ["../../.bashrc", "../../../../home/box/.profile", "a/../../b", "..", ".", "", "x\0y", "..\\..\\evil"]) {
    test(JSON.stringify(name), () => {
      const dir = path.join(HOME, "media");
      const file = mediaFilePath(dir, name);
      assert.equal(path.dirname(file), path.resolve(dir));
    });
  }
  test("正常文件名保留", () => {
    assert.equal(safeMediaName("报告.pdf"), "报告.pdf");
  });
});

describe("monitor 不会因为看不到 MCP 进程而自我卸载", { timeout: 60_000 }, () => {
  let server;
  let child;

  before(async () => {
    server = http.createServer((req, res) => {
      req.resume();
      req.on("end", async () => {
        if (req.url === "/ilink/bot/getupdates") await sleep(300);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ret: 0, msgs: [] }));
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    store.saveState({
      ...store.emptyState(),
      accounts: [{ ...store.emptyAccount(), token: "tok", baseUrl: `http://127.0.0.1:${server.address().port}`, ilinkBotId: "bot1", ilinkUserId: "owner" }],
    });
    child = spawn(process.execPath, [INDEX, "--monitor"], {
      env: { ...process.env, GROK_WECHAT_HOME: HOME },
      stdio: "ignore",
    });
  });

  after(() => {
    child?.kill("SIGKILL");
    server?.close();
    fs.rmSync(HOME, { recursive: true, force: true });
  });

  test("超过 30s 后 monitor 仍在跑、登录态仍在", async () => {
    await sleep(36_000);
    assert.equal(child.exitCode, null, "monitor 不应退出");
    assert.ok(fs.existsSync(store.paths().state), "account.json 不应被删");
  });
});
