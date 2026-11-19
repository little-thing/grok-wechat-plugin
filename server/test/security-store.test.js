import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ITEM, normalizeInbound } from "../ilink.js";
import {
  appendInbox, drainInbox, emptyState, loadFallbackWake, loadState, paths,
  readPid, saveGlobalWake, saveState, saveStateSecure, updateState, writePid,
} from "../store.js";

function fixture(t, custom) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "grok-wechat-store-"));
  const prevHome = process.env.HOME;
  const prevCustom = process.env.GROK_WECHAT_HOME;
  const prevUmask = process.umask(0o022);
  process.env.HOME = root;
  if (custom) process.env.GROK_WECHAT_HOME = path.join(root, custom);
  else delete process.env.GROK_WECHAT_HOME;
  t.after(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevCustom === undefined) delete process.env.GROK_WECHAT_HOME;
    else process.env.GROK_WECHAT_HOME = prevCustom;
    process.umask(prevUmask);
    fs.rmSync(root, { recursive: true, force: true });
  });
}

function mode(file) {
  return fs.statSync(file).mode & 0o777;
}

test("state and wake replacements use private modes under the process umask", (t) => {
  fixture(t);
  const { home, state, media } = paths();
  saveState(emptyState());
  assert.equal(mode(home), 0o700);
  assert.equal(mode(media), 0o700);
  assert.equal(mode(state), 0o600);

  fs.chmodSync(home, 0o755);
  fs.chmodSync(state, 0o644);
  const oldWarn = process.emitWarning;
  process.emitWarning = () => {};
  try {
    updateState((current) => ({ ...current, allowFrom: ["fixture"] }));
  } finally {
    process.emitWarning = oldWarn;
  }
  assert.equal(mode(home), 0o700);
  assert.equal(mode(state), 0o600);
  assert.deepEqual(loadState().allowFrom, ["fixture"]);
  saveStateSecure(emptyState());
  assert.equal(mode(state), 0o600);

  const wake = path.join(home, "wake.json");
  fs.writeFileSync(wake, "{}");
  saveGlobalWake("https://example.invalid/wake", "test-key");
  assert.equal(mode(wake), 0o600);
  assert.deepEqual(loadFallbackWake(), { url: "https://example.invalid/wake", key: "test-key" });
});

test("existing custom homes retain their directory mode and support monitor I/O", (t) => {
  fixture(t, "custom home");
  const { home, inbox, log, media, pid, state } = paths();
  fs.mkdirSync(home, { mode: 0o750 });
  fs.writeFileSync(log, "fixture log", { mode: 0o644 });
  const warnings = [];
  const oldWarn = process.emitWarning;
  process.emitWarning = (warning) => warnings.push(warning);
  try {
    saveState({ token: "legacy", ilinkBotId: "test-bot" });
    assert.equal(loadState().accounts[0].ilinkBotId, "test-bot");
  } finally {
    process.emitWarning = oldWarn;
  }
  assert.ok(warnings.some((warning) => warning.includes("mode 750")));
  assert.ok(warnings.some((warning) => warning.includes("monitor.log has mode 644")));
  assert.equal(mode(home), 0o750);
  assert.equal(mode(media), 0o700);
  assert.equal(mode(state), 0o600);
  writePid(123);
  assert.equal(readPid(), 123);
  assert.equal(mode(pid), 0o600);
  appendInbox([{ value: "fixture" }]);
  assert.deepEqual(drainInbox(), [{ value: "fixture" }]);
  assert.equal(mode(inbox), 0o600);
});

test("a failed rename leaves no temporary credential file", (t) => {
  fixture(t);
  const { home, state } = paths();
  fs.mkdirSync(state, { recursive: true });
  assert.throws(() => saveState(emptyState()));
  assert.deepEqual(fs.readdirSync(home).sort(), ["account.json", "media"]);
});

test("read-only state loading warns about the custom home, even if its files are private", (t) => {
  fixture(t, "read-only");
  const { home, state } = paths();
  fs.mkdirSync(home, { mode: 0o755 });
  fs.writeFileSync(state, JSON.stringify(emptyState()), { mode: 0o600 });
  const warnings = [];
  const oldWarn = process.emitWarning;
  process.emitWarning = (warning) => warnings.push(warning);
  try {
    assert.deepEqual(loadState({ createHome: false }), emptyState());
  } finally {
    process.emitWarning = oldWarn;
  }
  assert.ok(warnings.some((warning) => warning.includes(home + " has mode 755")));
  assert.equal(mode(home), 0o755);
});

test("linked credential files are rejected for reads and writes", (t) => {
  fixture(t, "linked-files");
  const { home, state } = paths();
  fs.mkdirSync(home, { mode: 0o700 });
  const target = path.join(path.dirname(home), "credential-target");
  const original = JSON.stringify({ token: "fixture", ilinkBotId: "fixture", url: "https://example.invalid", key: "fixture" });
  fs.writeFileSync(target, original, { mode: 0o644 });
  fs.symlinkSync(target, state);
  fs.symlinkSync(target, path.join(home, "wake.json"));
  assert.throws(() => loadState(), /credential file is a symbolic link/);
  assert.throws(() => loadFallbackWake(), /credential file is a symbolic link/);
  assert.throws(() => saveState(emptyState()), /credential file is a symbolic link/);
  assert.throws(() => saveGlobalWake("https://example.invalid", "fixture"), /credential file is a symbolic link/);
  assert.equal(fs.readFileSync(target, "utf8"), original);
});

test("linked state homes and linked ancestors are rejected before creating credential files", (t) => {
  fixture(t, "alias");
  const { home } = paths();
  const target = path.join(path.dirname(home), "actual");
  fs.mkdirSync(target, { mode: 0o700 });
  fs.symlinkSync(target, home, "dir");
  for (const configured of [home, path.join(home, "missing")]) {
    process.env.GROK_WECHAT_HOME = configured;
    assert.throws(() => loadState(), /state directory must be a real directory/);
    assert.throws(() => loadFallbackWake(), /state directory must be a real directory/);
    assert.throws(() => saveState(emptyState()), /state directory must be a real directory/);
    assert.throws(() => saveGlobalWake("https://example.invalid", "fixture"), /state directory must be a real directory/);
  }
  assert.deepEqual(fs.readdirSync(target), []);
});

test("inbound media writes to a private directory and rechecks it after downloading", async (t) => {
  fixture(t, "media");
  const { home, media } = paths();
  const key = Buffer.alloc(16);
  const cipher = createCipheriv("aes-128-ecb", key, null);
  const contents = Buffer.from("test attachment");
  const encrypted = Buffer.concat([cipher.update(contents), cipher.final()]);
  const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response(encrypted));
  const message = {
    item_list: [{ type: ITEM.FILE, file_item: {
      file_name: "attachment.txt",
      media: { full_url: "https://example.invalid/attachment", aes_key: key.toString("base64") },
    } }],
  };

  const { items: [{ path: saved }] } = await normalizeInbound(message);
  assert.equal(path.dirname(saved), media);
  assert.deepEqual(fs.readFileSync(saved), contents);
  assert.equal(mode(media), 0o700);
  assert.equal(mode(saved), 0o600);

  const outside = path.join(path.dirname(home), "outside-media");
  fs.mkdirSync(outside, { mode: 0o700 });
  fetchMock.mock.mockImplementation(async () => {
    fs.rmSync(media, { recursive: true });
    fs.symlinkSync(outside, media, "dir");
    return new Response(encrypted);
  });
  const blocked = await normalizeInbound(message);
  assert.equal(blocked.items[0].path, null);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.throws(() => loadState(), /state directory must be a real directory/);
});
