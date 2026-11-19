import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { validateStateHome } from "../uninstall.js";

const script = fileURLToPath(new URL("../../scripts/uninstall.sh", import.meta.url));
const entry = fileURLToPath(new URL("../uninstall.js", import.meta.url));

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grok-wechat-uninstall-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("the validator accepts the reserved state home and rejects roots and symlink aliases", (t) => {
  const root = fixture(t);
  const home = path.join(root, ".grok-wechat");
  const link = path.join(root, "alias");
  fs.mkdirSync(home);
  fs.symlinkSync(root, link);
  assert.equal(validateStateHome(home, [home], [root]).dedicated, true);
  assert.equal(validateStateHome(root, [], [root]), null);
  assert.equal(validateStateHome(path.parse(root).root, [], []), null);
  assert.equal(validateStateHome(".grok-wechat", [], []), null);
  assert.equal(validateStateHome(link, [link], []), null);
  assert.equal(validateStateHome(path.join(link, ".grok-wechat"), [path.join(link, ".grok-wechat")], []), null);
});

test("the validator scopes legacy custom homes to recognizable plugin artifacts", (t) => {
  const root = fixture(t);
  const custom = path.join(root, "custom state");
  const media = path.join(custom, "media");
  fs.mkdirSync(media, { recursive: true });
  fs.writeFileSync(path.join(custom, "unrelated.txt"), "keep");
  assert.equal(validateStateHome(custom, [], [root]), null);
  const account = path.join(custom, "account.json");
  const attachment = path.join(media, "1720000000000-test.txt");
  fs.writeFileSync(account, JSON.stringify({ token: "fixture", ilinkBotId: "fixture-bot" }));
  fs.writeFileSync(attachment, "plugin data");
  fs.writeFileSync(path.join(media, "personal-photo.jpg"), "keep");
  const result = validateStateHome(custom, [], [root]);
  assert.equal(result.dedicated, false);
  assert.deepEqual(result.files.map((file) => file.path), [account, attachment]);
});

function runCli(home, state, options = [], nodeOptions = []) {
  return spawnSync(process.execPath, [...nodeOptions, entry, "--uninstall", ...options], {
    encoding: "utf8",
    env: { HOME: home, GROK_WECHAT_HOME: state, PATH: "" },
    timeout: 5_000,
  });
}

function resultOf(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("the CLI requires a valid confirmation and cleans only approved custom files", (t) => {
  const root = fixture(t);
  const custom = path.join(root, "custom state");
  fs.mkdirSync(custom);
  const account = path.join(custom, "account.json");
  const unrelated = path.join(custom, "journal.txt");
  const unrelatedWake = path.join(custom, "wake.json");
  const temporary = ["account", "wake"].map((name) => path.join(custom, `${name}.json.${randomUUID()}.tmp`));
  const similar = path.join(custom, "account.json.backup.tmp");
  const link = path.join(custom, `wake.json.${randomUUID()}.tmp`);
  fs.writeFileSync(account, JSON.stringify({ accounts: [], pendingQrs: [], allowFrom: [] }), { mode: 0o600 });
  for (const file of temporary) fs.writeFileSync(file, '{"interrupted":', { mode: 0o600 });
  for (const file of [unrelated, similar]) fs.writeFileSync(file, "keep", { mode: 0o600 });
  fs.writeFileSync(unrelatedWake, JSON.stringify({ url: "", key: "" }), { mode: 0o600 });
  fs.symlinkSync(unrelated, link);

  const preview = resultOf(runCli(root, custom));
  const invalid = resultOf(runCli(root, custom, ["--confirm", "invalid"]));
  assert.equal(preview.confirmation_required, true);
  assert.equal(invalid.confirmation_required, true);
  assert.equal(invalid.uninstalled, false);
  assert.match(preview.confirmation_token, /^[a-f0-9]{64}$/);
  assert.deepEqual(preview.state_dirs.find((dir) => dir.path === custom).files, [account, ...temporary]);
  assert.ok([account, ...temporary].every((file) => fs.existsSync(file)));

  const confirmed = resultOf(runCli(root, custom, ["--confirm", preview.confirmation_token]));
  assert.equal(confirmed.uninstalled, true);
  assert.deepEqual(confirmed.retained_state_dirs, [custom]);
  for (const file of [account, ...temporary]) assert.equal(fs.existsSync(file), false);
  for (const file of [unrelated, similar, link]) assert.equal(fs.readFileSync(file, "utf8"), "keep");
  assert.deepEqual(JSON.parse(fs.readFileSync(unrelatedWake, "utf8")), { url: "", key: "" });
});

test("empty credential placeholders alone do not make a custom directory eligible for cleanup", (t) => {
  const root = fixture(t);
  const custom = path.join(root, "other-app");
  fs.mkdirSync(custom);
  fs.writeFileSync(path.join(custom, "account.json"), JSON.stringify({ token: "", ilinkBotId: "" }));
  fs.writeFileSync(path.join(custom, "wake.json"), JSON.stringify({ url: " ", key: "" }));
  assert.equal(validateStateHome(custom), null);
  const preview = resultOf(runCli(root, custom));
  assert.equal(preview.skipped_custom_home, custom);
});

test("an unpublished credential can be confirmed on its own when its contents identify it", (t) => {
  const root = fixture(t);
  const custom = path.join(root, "first-write");
  fs.mkdirSync(custom);
  const temporary = path.join(custom, `wake.json.${randomUUID()}.tmp`);
  const partial = path.join(custom, `wake.json.${randomUUID()}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify({ url: "https://example.invalid", key: "fixture" }), { mode: 0o600 });
  fs.writeFileSync(partial, '{"partial":', { mode: 0o600 });
  const preview = resultOf(runCli(root, custom));
  assert.deepEqual(preview.state_dirs.find((dir) => dir.path === custom).files, [temporary]);
  const confirmed = resultOf(runCli(root, custom, ["--confirm", preview.confirmation_token]));
  assert.equal(confirmed.uninstalled, true);
  assert.equal(fs.existsSync(temporary), false);
  assert.equal(fs.existsSync(partial), true);
});

test("an interrupted profile replacement preserves the old file and can be retried", (t) => {
  const root = fixture(t);
  const custom = path.join(root, "state");
  const profile = path.join(root, ".bashrc");
  const kept = "export KEEP=yes\n";
  const original = "node /fixture/grok-wechat-plugin/server/index.js --ensure-monitor\n" + kept;
  fs.writeFileSync(profile, original, { mode: 0o640 });
  const hook = path.join(root, "fail-write.cjs");
  fs.writeFileSync(hook, `const fs = require("node:fs");
const write = fs.writeFileSync;
fs.writeFileSync = (file, content, ...args) => {
  if (typeof file === "number" && content === ${JSON.stringify(kept)}) {
    write(file, content.slice(0, 5), ...args);
    throw Object.assign(new Error("simulated partial write"), { code: "EIO" });
  }
  return write(file, content, ...args);
};`);

  const preview = resultOf(runCli(root, custom));
  assert.deepEqual(preview.profile_files, [profile]);
  const args = ["--confirm", preview.confirmation_token];
  const failed = runCli(root, custom, args, ["--require", hook]);
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /simulated partial write/);
  assert.equal(fs.readFileSync(profile, "utf8"), original);
  assert.deepEqual(fs.readdirSync(root).sort(), [".bashrc", "fail-write.cjs"]);

  const confirmed = resultOf(runCli(root, custom, args));
  assert.deepEqual(confirmed.removed_autostart, [profile]);
  assert.equal(fs.readFileSync(profile, "utf8"), kept);
  assert.equal(fs.statSync(profile).mode & 0o777, 0o640);
});

test("the shell wrapper stops when the validated uninstaller is missing", (t) => {
  const root = fixture(t);
  const scripts = path.join(root, "scripts");
  const server = path.join(root, "server");
  fs.mkdirSync(scripts);
  fs.mkdirSync(server);
  fs.copyFileSync(script, path.join(scripts, "uninstall.sh"));
  fs.writeFileSync(path.join(server, "index.js"), "");
  const result = spawnSync("/bin/sh", [path.join(scripts, "uninstall.sh")], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires Node\.js and server\/uninstall\.js/);
});
