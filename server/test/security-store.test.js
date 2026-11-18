import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  appendInbox, drainInbox, emptyState, loadFallbackWake, loadState, paths,
  readPid, saveGlobalWake, saveState, saveStateSecure, updateState, writePid,
} from "../store.js";

function fixture(t, custom) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-wechat-store-"));
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
