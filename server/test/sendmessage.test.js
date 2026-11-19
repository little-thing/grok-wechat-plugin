import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { ITEM, sendMedia, sendText } from "../ilink.js";
import { emptyAccount, emptyState, rememberContext, saveState } from "../store.js";

const baseUrl = "https://ilink.test";
const sendUrl = `${baseUrl}/ilink/bot/sendmessage`;
const mediaFixture = fileURLToPath(new URL("../package.json", import.meta.url));
let stateDir;

before(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-wechat-send-test-"));
  process.env.GROK_WECHAT_HOME = stateDir;
  const account = {
    ...emptyAccount(),
    baseUrl,
    token: "mock-token",
    ilinkBotId: "bot",
    ilinkUserId: "owner",
  };
  const state = { ...emptyState(), accounts: [account] };
  rememberContext(state, account, "peer", "mock-context");
  saveState(state);
});

after(() => {
  if (stateDir) fs.rmSync(stateDir, { recursive: true, force: true });
});

for (const response of [{ ret: 0 }, { errcode: 0 }, {}]) {
  test(`text accepts ${JSON.stringify(response)} and preserves the success payload`, async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async (url, init) => {
      assert.equal(url, sendUrl);
      assert.equal(JSON.parse(init.body).msg.item_list[0].type, ITEM.TEXT);
      return Response.json(response);
    });
    assert.deepEqual(await sendText("peer", "Hello", "bot"), {
      to_user_id: "peer",
      ilink_bot_id: "bot",
      ilink_user_id: "owner",
      context_token: "mock-context",
      ret: 0,
    });
    assert.equal(fetchMock.mock.callCount(), 1);
  });
}

for (const [response, expected] of [
  [{ errcode: 42, errmsg: "mock failure" }, /errcode=42.*mock failure/],
  [{ ret: 0, errcode: 42 }, /errcode=42/],
  [{ ret: 42, errcode: 0 }, /ret=42/],
  [{ ret: -14 }, /ret=-14.*先在微信中给机器人发一条新消息/],
  [{ errcode: -14 }, /errcode=-14.*先在微信中给机器人发一条新消息/],
  [{ ret: 42, errcode: -14 }, /errcode=-14.*先在微信中给机器人发一条新消息/],
]) {
  test(`text rejects ${JSON.stringify(response)}`, async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async (url) => {
      assert.equal(url, sendUrl);
      return Response.json(response);
    });
    await assert.rejects(sendText("peer", "Hello", "bot"), expected);
    assert.equal(fetchMock.mock.callCount(), 1);
  });
}

test("media uses the same sendmessage error handling after upload", async (t) => {
  const uploadUrl = "https://cdn.test/upload";
  const fetchMock = t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url === `${baseUrl}/ilink/bot/getuploadurl`) {
      return Response.json({ upload_full_url: uploadUrl });
    }
    if (url === uploadUrl) {
      return new Response(null, { headers: { "x-encrypted-param": "mock-upload" } });
    }
    assert.equal(url, sendUrl);
    assert.equal(JSON.parse(init.body).msg.item_list[0].type, ITEM.FILE);
    return Response.json({ ret: 0, errcode: -14 });
  });
  await assert.rejects(
    sendMedia("peer", mediaFixture, "file", "", "bot"),
    /errcode=-14.*先在微信中给机器人发一条新消息/,
  );
  assert.equal(fetchMock.mock.callCount(), 3);
});
