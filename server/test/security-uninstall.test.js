import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("the CLI previews absolute paths and rejects an invalid confirmation", (t) => {
  const root = fixture(t);
  const custom = path.join(root, "custom state");
  fs.mkdirSync(custom);
  fs.writeFileSync(path.join(custom, "account.json"), JSON.stringify({
    accounts: [], pendingQrs: [], allowFrom: [],
  }), { mode: 0o600 });
  for (const options of [[], ["--confirm", "invalid"]]) {
    const result = spawnSync(process.execPath, [entry, "--uninstall", ...options], {
      encoding: "utf8",
      env: { HOME: root, GROK_WECHAT_HOME: custom, PATH: "" },
    });
    assert.equal(result.status, 0, result.stderr);
    const preview = JSON.parse(result.stdout);
    assert.equal(preview.confirmation_required, true);
    assert.equal(preview.uninstalled, false);
    assert.match(preview.confirmation_token, /^[a-f0-9]{64}$/);
    assert.ok(preview.state_dirs.some((dir) => dir.path === custom));
    assert.ok(fs.existsSync(path.join(custom, "account.json")));
  }
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
