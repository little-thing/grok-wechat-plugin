import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  contextFor,
  emptyAccount,
  findAccount,
  hasAccountWake,
  hasGlobalWake,
  listAccounts,
  loadState,
  localTokenList,
  paths,
  peekInboxCount,
  rememberContext,
  resolveAccountForPeer,
  requireAccount,
  saveGlobalWake,
  saveStateSecure,
  updateState,
  upsertAccount,
} from "./store.js";

const CHANNEL_VERSION = "1.0.0";
const BOT_AGENT = "Grokbot/1.0.0";
const ILINK_APP_ID = "bot";
const ILINK_APP_CLIENT_VERSION = ((1 & 0xff) << 16) | ((0 & 0xff) << 8) | (0 & 0xff);
const CDN_BASE = "https://novac2c.cdn.weixin.qq.com/c2c";
const LONG_POLL_MS = 35_000;
const API_TIMEOUT_MS = 15_000;
const ERR_SESSION_EXPIRED = -14;

export const ITEM = { TEXT: 1, IMAGE: 2, VOICE: 3, FILE: 4, VIDEO: 5 };
export const MSG_TYPE = { USER: 1, BOT: 2 };
export const MSG_STATE = { NEW: 0, GENERATING: 1, FINISH: 2 };
export const UPLOAD = { IMAGE: 1, VIDEO: 2, FILE: 3, VOICE: 4 };
export const TYPING = { ON: 1, OFF: 2 };

function randomUin() {
  return Buffer.from(String(crypto.randomBytes(4).readUInt32BE(0)), "utf8").toString("base64");
}

function clientId() {
  return `grok-wechat-${crypto.randomBytes(6).toString("hex")}`;
}

function baseInfo() {
  return { channel_version: CHANNEL_VERSION, bot_agent: BOT_AGENT };
}

function commonHeaders() {
  return {
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": String(ILINK_APP_CLIENT_VERSION),
  };
}

function postHeaders(token) {
  const headers = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomUin(),
    ...commonHeaders(),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function joinUrl(base, endpoint) {
  const root = base.endsWith("/") ? base : `${base}/`;
  return new URL(endpoint, root).toString();
}

async function fetchText(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
    return { text, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

export async function apiGet(baseUrl, endpoint, timeoutMs = API_TIMEOUT_MS) {
  const { text } = await fetchText(
    joinUrl(baseUrl, endpoint),
    { method: "GET", headers: commonHeaders() },
    timeoutMs,
  );
  return JSON.parse(text);
}

export async function apiPost(baseUrl, endpoint, body, token, timeoutMs = API_TIMEOUT_MS) {
  const { text } = await fetchText(
    joinUrl(baseUrl, endpoint),
    {
      method: "POST",
      headers: postHeaders(token),
      body: JSON.stringify({ ...body, base_info: baseInfo() }),
    },
    timeoutMs,
  );
  return JSON.parse(text);
}

function accountSummary(account) {
  return {
    ilink_bot_id: account.ilinkBotId,
    ilink_user_id: account.ilinkUserId,
    logged_in: Boolean(account.token),
    has_wake: hasAccountWake(account),
    dedicated_assistant_id: account.dedicatedAssistant?.id || "",
    dedicated_assistant_name: account.dedicatedAssistant?.name || "",
  };
}

function applyLoginConfirm(state, last) {
  const account = {
    ...emptyAccount(),
    token: last.bot_token,
    ilinkBotId: last.ilink_bot_id || "",
    ilinkUserId: last.ilink_user_id || "",
    baseUrl: last.baseurl || state.accounts[0]?.baseUrl || emptyAccount().baseUrl,
  };
  upsertAccount(state, account);
  return account;
}

export async function loginStart() {
  const state = loadState();
  const baseUrl = state.accounts[0]?.baseUrl || emptyAccount().baseUrl;
  const data = await apiPost(baseUrl, "ilink/bot/get_bot_qrcode?bot_type=3", {
    local_token_list: localTokenList(state),
  });
  const qrcode = data.qrcode;
  const img = data.qrcode_img_content || data.url || "";
  if (!qrcode) throw new Error(`获取二维码失败: ${JSON.stringify(data)}`);
  updateState((s) => {
    s.pendingQrs.push({ qrcode, img, at: Date.now() });
    return s;
  });
  return {
    qrcode,
    image: img,
    existing_accounts: listAccounts(state).map(accountSummary),
    next: "wechat_login_wait",
    hint: "向用户展示二维码后，立即调用 wechat_login_wait，轮询至 logged_in=true。",
  };
}

export async function loginWait(timeoutMs = 120_000, qrcodeArg) {
  const state = loadState();
  const qrcode = qrcodeArg || state.pendingQrs.at(-1)?.qrcode;
  if (!qrcode) throw new Error("没有进行中的登录，先调用 wechat_login_start");
  const baseUrl = state.accounts[0]?.baseUrl || emptyAccount().baseUrl;
  const deadline = Date.now() + timeoutMs;
  let last = { status: "wait" };
  while (Date.now() < deadline) {
    last = await apiGet(
      baseUrl,
      `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      LONG_POLL_MS + 5_000,
    );
    if (last.status === "confirmed" && last.bot_token) {
      let account;
      updateState((s) => {
        s.pendingQrs = s.pendingQrs.filter((p) => p.qrcode !== qrcode);
        account = applyLoginConfirm(s, last);
        return s;
      });
      return {
        logged_in: true,
        account: accountSummary(account),
        ilink_bot_id: account.ilinkBotId,
        ilink_user_id: account.ilinkUserId,
        accounts: listAccounts(loadState()).map(accountSummary),
        hint: "绑定完成。为该号创建专属 Grok Bot 助手，调用 wechat_set_dedicated_assistant 登记 assistant_id 与 assistant_name。后续扫码绑定无需再配 webhook。",
      };
    }
    if (last.status === "binded_redirect" && last.bot_token) {
      let account;
      updateState((s) => {
        s.pendingQrs = s.pendingQrs.filter((p) => p.qrcode !== qrcode);
        account = applyLoginConfirm(s, last);
        return s;
      });
      return {
        logged_in: true,
        redirected: true,
        account: accountSummary(account),
        ilink_bot_id: account.ilinkBotId,
        ilink_user_id: account.ilinkUserId,
        accounts: listAccounts(loadState()).map(accountSummary),
        hint: "绑定完成。为该号创建专属 Grok Bot 助手，调用 wechat_set_dedicated_assistant 登记 assistant_id 与 assistant_name。后续扫码绑定无需再配 webhook。",
      };
    }
    if (last.status === "expired") {
      updateState((s) => {
        s.pendingQrs = s.pendingQrs.filter((p) => p.qrcode !== qrcode);
        return s;
      });
      return { logged_in: false, expired: true, next: "wechat_login_start", hint: "调用 wechat_login_start 取新码，出码后立即 wechat_login_wait" };
    }
  }
  return { logged_in: false, status: last.status || "wait", next: "wechat_login_wait", hint: "立即再次调用 wechat_login_wait" };
}

export async function notifyStart(account) {
  try {
    await apiPost(account.baseUrl, "ilink/bot/msg/notifystart", {}, account.token, 10_000);
  } catch {
    // 部分环境未开放该接口
  }
}

export async function notifyStop(account) {
  if (!account?.token) return;
  try {
    await apiPost(account.baseUrl, "ilink/bot/msg/notifystop", {}, account.token, 10_000);
  } catch {
    // ignore
  }
}

export async function getUpdates(account) {
  let data;
  try {
    data = await apiPost(
      account.baseUrl,
      "ilink/bot/getupdates",
      { get_updates_buf: account.getUpdatesBuf || "" },
      account.token,
      LONG_POLL_MS + 5_000,
    );
  } catch (err) {
    if (err?.name === "AbortError") {
      return { ret: 0, msgs: [], session_expired: false };
    }
    throw err;
  }
  if (data.errcode === ERR_SESSION_EXPIRED || data.ret === ERR_SESSION_EXPIRED) {
    return { ret: data.ret ?? 0, msgs: [], session_expired: true };
  }
  if (typeof data.get_updates_buf === "string") {
    updateState((s) => {
      const hit = findAccount(s, { token: account.token });
      if (hit) hit.getUpdatesBuf = data.get_updates_buf;
      return s;
    });
    account.getUpdatesBuf = data.get_updates_buf;
  }
  return { ...data, session_expired: false };
}

function parseAesKey(raw) {
  if (!raw) throw new Error("缺少 aes_key");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 16) return decoded;
  const asText = decoded.toString("utf8");
  if (/^[0-9a-fA-F]{32}$/.test(asText)) return Buffer.from(asText, "hex");
  if (decoded.length === 32 && /^[0-9a-fA-F]+$/.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  throw new Error("无法解析 aes_key");
}

function aesEcb(buffer, key, mode) {
  const cipher = mode === "encrypt"
    ? crypto.createCipheriv("aes-128-ecb", key, null)
    : crypto.createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(buffer), cipher.final()]);
}

function paddedSize(n) {
  return Math.ceil((n + 1) / 16) * 16;
}

async function downloadMedia(media, label) {
  const param = media?.encrypt_query_param || "";
  const fullUrl = media?.full_url || "";
  if (!param && !fullUrl) return null;
  const url = fullUrl || `${CDN_BASE}/download?encrypted_query_param=${encodeURIComponent(param)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载媒体失败 ${res.status}`);
  const cipher = Buffer.from(await res.arrayBuffer());
  const key = parseAesKey(media.aes_key);
  const plain = aesEcb(cipher, key, "decrypt");
  const file = path.join(paths().media, `${Date.now()}-${label}`);
  fs.writeFileSync(file, plain);
  return file;
}

function itemText(item) {
  if (item?.text_item?.text) return item.text_item.text;
  if (item?.voice_item?.text) return item.voice_item.text;
  if (item?.ref_msg?.title) return `引用: ${item.ref_msg.title}`;
  return "";
}

export async function normalizeInbound(msg) {
  const from = msg.from_user_id || "";
  const items = [];
  let text = "";
  for (const [i, item] of (msg.item_list || []).entries()) {
    const type = item.type;
    const piece = itemText(item);
    if (piece) text = text ? `${text}\n${piece}` : piece;
    if (type === ITEM.IMAGE && item.image_item?.media) {
      const file = await downloadMedia(item.image_item.media, `image-${i}.bin`).catch(() => null);
      items.push({ type: "image", path: file });
    } else if (type === ITEM.FILE && item.file_item) {
      const file = await downloadMedia(item.file_item.media, item.file_item.file_name || `file-${i}`).catch(() => null);
      items.push({ type: "file", name: item.file_item.file_name || "", path: file });
    } else if (type === ITEM.VIDEO && item.video_item?.media) {
      const file = await downloadMedia(item.video_item.media, `video-${i}.bin`).catch(() => null);
      items.push({ type: "video", path: file });
    } else if (type === ITEM.VOICE && item.voice_item) {
      items.push({ type: "voice", text: item.voice_item.text || "", playtime_ms: item.voice_item.playtime });
    } else if (type === ITEM.TEXT) {
      items.push({ type: "text", text: piece });
    }
  }
  return {
    from_user_id: from,
    context_token: msg.context_token || "",
    message_id: msg.message_id ?? msg.client_id ?? "",
    create_time_ms: msg.create_time_ms,
    text,
    items,
  };
}

export async function collectInbound(rawMsgs, account) {
  const out = [];
  for (const msg of rawMsgs || []) {
    if (msg.message_type && msg.message_type !== MSG_TYPE.USER) continue;
    if (msg.message_state && msg.message_state !== MSG_STATE.FINISH) continue;
    const normalized = await normalizeInbound(msg);
    if (!normalized.from_user_id) continue;
    updateState((s) => {
      const hit = findAccount(s, { token: account.token });
      if (hit) rememberContext(s, hit, normalized.from_user_id, normalized.context_token);
      return s;
    });
    out.push({
      ...normalized,
      ilink_bot_id: account.ilinkBotId,
      ilink_user_id: account.ilinkUserId,
    });
  }
  return { messages: out, logged_in_user: account.ilinkUserId };
}

export function toWeChatText(markdown) {
  return String(markdown ?? "")
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*\n?|```/g, "").trim())
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 $2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .trim();
}

async function sendItem(account, to, item, contextToken) {
  const token = contextToken || contextFor(account, to);
  const body = {
    msg: {
      from_user_id: "",
      to_user_id: to,
      client_id: clientId(),
      message_type: MSG_TYPE.BOT,
      message_state: MSG_STATE.FINISH,
      item_list: [item],
      context_token: token || undefined,
    },
  };
  const resp = await apiPost(account.baseUrl, "ilink/bot/sendmessage", body, account.token);
  if (resp.ret && resp.ret !== 0) {
    throw new Error(`发送失败 ret=${resp.ret} ${resp.errmsg || ""}`);
  }
  return {
    to_user_id: to,
    ilink_bot_id: account.ilinkBotId,
    ilink_user_id: account.ilinkUserId,
    context_token: token || "",
    ret: resp.ret ?? 0,
  };
}

export async function sendText(toUserId, text, ilinkBotId) {
  const state = loadState();
  const account = resolveAccountForPeer(state, { to_user_id: toUserId, ilink_bot_id: ilinkBotId });
  const to = toUserId;
  const token = contextFor(account, to);
  if (!token) {
    throw new Error("还没有该用户的 context_token。对方需要先从微信给你发一条消息，会话通道才会建立");
  }
  const plain = toWeChatText(text);
  if (!plain) throw new Error("发送内容为空");
  const chunks = [];
  for (let i = 0; i < plain.length; i += 4000) chunks.push(plain.slice(i, i + 4000));
  let last;
  for (const chunk of chunks) {
    last = await sendItem(account, to, { type: ITEM.TEXT, text_item: { text: chunk } }, token);
  }
  return last;
}

async function uploadFile(account, to, filePath, mediaType) {
  const raw = fs.readFileSync(filePath);
  const rawMd5 = crypto.createHash("md5").update(raw).digest("hex");
  const aesKey = crypto.randomBytes(16);
  const aesKeyHex = aesKey.toString("hex");
  const cipher = aesEcb(raw, aesKey, "encrypt");
  const filekey = crypto.randomBytes(16).toString("hex");
  const upload = await apiPost(
    account.baseUrl,
    "ilink/bot/getuploadurl",
    {
      filekey,
      media_type: mediaType,
      to_user_id: to,
      rawsize: raw.length,
      rawfilemd5: rawMd5,
      filesize: paddedSize(raw.length),
      no_need_thumb: true,
      aeskey: aesKeyHex,
    },
    account.token,
  );
  const uploadUrl = upload.upload_full_url
    || `${CDN_BASE}/upload?encrypted_query_param=${encodeURIComponent(upload.upload_param || "")}&filekey=${encodeURIComponent(filekey)}`;
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: cipher,
  });
  if (!res.ok) throw new Error(`CDN 上传失败 ${res.status}`);
  const downloadParam = res.headers.get("x-encrypted-param") || "";
  if (!downloadParam) throw new Error("CDN 响应缺少 x-encrypted-param");
  return {
    filekey,
    fileSize: raw.length,
    fileSizeCiphertext: cipher.length,
    aeskeyHex: aesKeyHex,
    downloadEncryptedQueryParam: downloadParam,
  };
}

function mediaRef(uploaded) {
  return {
    encrypt_query_param: uploaded.downloadEncryptedQueryParam,
    aes_key: Buffer.from(uploaded.aeskeyHex).toString("base64"),
    encrypt_type: 1,
  };
}

export async function sendMedia(toUserId, filePath, kind, caption, ilinkBotId) {
  const state = loadState();
  const account = resolveAccountForPeer(state, { to_user_id: toUserId, ilink_bot_id: ilinkBotId });
  const to = toUserId;
  const token = contextFor(account, to);
  if (!token) throw new Error("还没有该用户的 context_token，需对方先发一条微信");
  if (!fs.existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`);
  const typeMap = { image: UPLOAD.IMAGE, video: UPLOAD.VIDEO, file: UPLOAD.FILE };
  const mediaType = typeMap[kind];
  if (!mediaType) throw new Error("kind 只能是 image / video / file");
  if (caption) await sendText(to, caption, account.ilinkBotId);
  const uploaded = await uploadFile(account, to, filePath, mediaType);
  const media = mediaRef(uploaded);
  if (kind === "image") {
    return sendItem(account, to, { type: ITEM.IMAGE, image_item: { media, mid_size: uploaded.fileSizeCiphertext } }, token);
  }
  if (kind === "video") {
    return sendItem(account, to, { type: ITEM.VIDEO, video_item: { media, video_size: uploaded.fileSizeCiphertext } }, token);
  }
  return sendItem(account, to, {
    type: ITEM.FILE,
    file_item: { media, file_name: path.basename(filePath), len: String(uploaded.fileSize) },
  }, token);
}

export async function setTyping(toUserId, on, ilinkBotId) {
  const state = loadState();
  const account = resolveAccountForPeer(state, { to_user_id: toUserId, ilink_bot_id: ilinkBotId });
  const to = toUserId;
  let ticket = account.typingTickets?.[to]?.ticket;
  const age = Date.now() - (account.typingTickets?.[to]?.at || 0);
  if (!ticket || age > 20 * 60 * 60 * 1000) {
    const cfg = await apiPost(
      account.baseUrl,
      "ilink/bot/getconfig",
      { ilink_user_id: to, context_token: contextFor(account, to) || undefined },
      account.token,
      10_000,
    );
    ticket = cfg.typing_ticket || "";
    if (ticket) {
      updateState((s) => {
        const hit = findAccount(s, { token: account.token });
        if (hit) hit.typingTickets[to] = { ticket, at: Date.now() };
        return s;
      });
    }
  }
  if (!ticket) throw new Error("未拿到 typing_ticket");
  await apiPost(
    account.baseUrl,
    "ilink/bot/sendtyping",
    { ilink_user_id: to, typing_ticket: ticket, status: on ? TYPING.ON : TYPING.OFF },
    account.token,
    10_000,
  );
  return { to_user_id: to, ilink_bot_id: account.ilinkBotId, typing: !!on };
}

export function statusPayload() {
  const state = loadState();
  const accounts = listAccounts(state);
  return {
    logged_in: accounts.length > 0,
    account_count: accounts.length,
    global_wake_configured: hasGlobalWake(),
    accounts: accounts.map((a) => ({
      ...accountSummary(a),
      peers: Object.keys(a.contextTokens || {}),
    })),
    pending_qr_count: state.pendingQrs.length,
    allow_from: state.allowFrom,
    inbox: peekInboxCount(),
  };
}

export async function probeWake(url, key) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source: "grok-wechat",
      probe: true,
      count: 0,
    }),
  });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 180) };
}

export async function setAccountWake(ilink_bot_id, url, key) {
  if (!url || !key) throw new Error("url 和 key 必填");
  const probe = await probeWake(url, key);
  saveGlobalWake(url, key);
  if (ilink_bot_id) {
    updateState((s) => {
      const hit = findAccount(s, { ilink_bot_id });
      if (hit) hit.wake = { url, key };
      return s;
    });
  }
  saveStateSecure(loadState());
  return {
    global_wake_configured: true,
    ilink_bot_id: ilink_bot_id || null,
    probe,
    accounts: listAccounts(loadState()).map(accountSummary),
  };
}

export function setDedicatedAssistant(ilink_bot_id, assistant_id, assistant_name) {
  if (!ilink_bot_id) throw new Error("ilink_bot_id 必填");
  if (!assistant_name) throw new Error("assistant_name 必填");
  updateState((s) => {
    const hit = requireAccount(s, { ilink_bot_id });
    hit.dedicatedAssistant = {
      id: assistant_id || hit.dedicatedAssistant?.id || "",
      name: assistant_name,
    };
    return s;
  });
  saveStateSecure(loadState());
  const account = findAccount(loadState(), { ilink_bot_id });
  return accountSummary(account);
}
