import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { contextFor, loadState, paths, rememberContext, updateState } from "./store.js";

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

export async function loginStart() {
  const state = loadState();
  // POST so base_info.bot_agent is on the wire; GET defaults to OpenClaw/ClawBot branding.
  const data = await apiPost(state.baseUrl, "ilink/bot/get_bot_qrcode?bot_type=3", {
    local_token_list: [],
  });
  const qrcode = data.qrcode;
  const img = data.qrcode_img_content || data.url || "";
  if (!qrcode) throw new Error(`获取二维码失败: ${JSON.stringify(data)}`);
  updateState((s) => {
    s.pendingQr = { qrcode, img, at: Date.now() };
    return s;
  });
  return { qrcode, image: img, hint: "用手机微信扫描该二维码并确认登录，然后调用 wechat_login_wait" };
}

export async function loginWait(timeoutMs = 120_000) {
  const state = loadState();
  const qrcode = state.pendingQr?.qrcode;
  if (!qrcode) throw new Error("没有进行中的登录，先调用 wechat_login_start");
  const deadline = Date.now() + timeoutMs;
  let last = { status: "wait" };
  while (Date.now() < deadline) {
    last = await apiGet(
      state.baseUrl,
      `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      LONG_POLL_MS + 5_000,
    );
    if (last.status === "confirmed" && last.bot_token) {
      updateState((s) => {
        s.token = last.bot_token;
        s.ilinkBotId = last.ilink_bot_id || "";
        s.ilinkUserId = last.ilink_user_id || "";
        if (last.baseurl) s.baseUrl = last.baseurl;
        s.pendingQr = null;
        return s;
      });
      return {
        logged_in: true,
        ilink_bot_id: last.ilink_bot_id || "",
        ilink_user_id: last.ilink_user_id || "",
      };
    }
    if (last.status === "expired") {
      return { logged_in: false, expired: true, hint: "二维码已过期，重新调用 wechat_login_start" };
    }
  }
  return { logged_in: false, status: last.status || "wait", hint: "继续调用 wechat_login_wait，或重新取码" };
}

function requireAccount() {
  const state = loadState();
  if (!state.token) throw new Error("未登录。先 wechat_login_start，扫码后再 wechat_login_wait");
  return state;
}

export async function notifyStart() {
  const state = requireAccount();
  try {
    await apiPost(state.baseUrl, "ilink/bot/msg/notifystart", {}, state.token, 10_000);
  } catch {
    // 部分环境未开放该接口
  }
}

export async function notifyStop() {
  const state = loadState();
  if (!state.token) return;
  try {
    await apiPost(state.baseUrl, "ilink/bot/msg/notifystop", {}, state.token, 10_000);
  } catch {
    // ignore
  }
}

export async function getUpdates() {
  const state = requireAccount();
  let data;
  try {
    data = await apiPost(
      state.baseUrl,
      "ilink/bot/getupdates",
      { get_updates_buf: state.getUpdatesBuf || "" },
      state.token,
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
      s.getUpdatesBuf = data.get_updates_buf;
      return s;
    });
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

export async function collectInbound(rawMsgs) {
  const state = loadState();
  const out = [];
  for (const msg of rawMsgs || []) {
    if (msg.message_type && msg.message_type !== MSG_TYPE.USER) continue;
    if (msg.message_state && msg.message_state !== MSG_STATE.FINISH) continue;
    const normalized = await normalizeInbound(msg);
    if (!normalized.from_user_id) continue;
    updateState((s) => rememberContext(s, normalized.from_user_id, normalized.context_token));
    out.push(normalized);
  }
  return { messages: out, logged_in_user: state.ilinkUserId };
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

async function sendItem(to, item, contextToken) {
  const state = requireAccount();
  const token = contextToken || contextFor(state, to);
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
  const resp = await apiPost(state.baseUrl, "ilink/bot/sendmessage", body, state.token);
  if (resp.ret && resp.ret !== 0) {
    throw new Error(`发送失败 ret=${resp.ret} ${resp.errmsg || ""}`);
  }
  return { to_user_id: to, context_token: token || "", ret: resp.ret ?? 0 };
}

export async function sendText(toUserId, text) {
  const state = requireAccount();
  const to = toUserId || state.lastFromUserId;
  if (!to) throw new Error("没有目标用户。传入 to_user_id，或等对方先发一条微信");
  const token = contextFor(state, to);
  if (!token) {
    throw new Error("还没有该用户的 context_token。对方需要先从微信给你发一条消息，会话通道才会建立");
  }
  const plain = toWeChatText(text);
  if (!plain) throw new Error("发送内容为空");
  const chunks = [];
  for (let i = 0; i < plain.length; i += 4000) chunks.push(plain.slice(i, i + 4000));
  let last;
  for (const chunk of chunks) {
    last = await sendItem(to, { type: ITEM.TEXT, text_item: { text: chunk } }, token);
  }
  return last;
}

async function uploadFile(to, filePath, mediaType) {
  const state = requireAccount();
  const raw = fs.readFileSync(filePath);
  const rawMd5 = crypto.createHash("md5").update(raw).digest("hex");
  const aesKey = crypto.randomBytes(16);
  const aesKeyHex = aesKey.toString("hex");
  const cipher = aesEcb(raw, aesKey, "encrypt");
  const filekey = crypto.randomBytes(16).toString("hex");
  const upload = await apiPost(
    state.baseUrl,
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
    state.token,
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

export async function sendMedia(toUserId, filePath, kind, caption) {
  const state = requireAccount();
  const to = toUserId || state.lastFromUserId;
  if (!to) throw new Error("没有目标用户");
  const token = contextFor(state, to);
  if (!token) throw new Error("还没有该用户的 context_token，需对方先发一条微信");
  if (!fs.existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`);
  const typeMap = { image: UPLOAD.IMAGE, video: UPLOAD.VIDEO, file: UPLOAD.FILE };
  const mediaType = typeMap[kind];
  if (!mediaType) throw new Error("kind 只能是 image / video / file");
  if (caption) await sendText(to, caption);
  const uploaded = await uploadFile(to, filePath, mediaType);
  const media = mediaRef(uploaded);
  if (kind === "image") {
    return sendItem(to, { type: ITEM.IMAGE, image_item: { media, mid_size: uploaded.fileSizeCiphertext } }, token);
  }
  if (kind === "video") {
    return sendItem(to, { type: ITEM.VIDEO, video_item: { media, video_size: uploaded.fileSizeCiphertext } }, token);
  }
  return sendItem(to, {
    type: ITEM.FILE,
    file_item: { media, file_name: path.basename(filePath), len: String(uploaded.fileSize) },
  }, token);
}

export async function setTyping(toUserId, on) {
  const state = requireAccount();
  const to = toUserId || state.lastFromUserId;
  if (!to) throw new Error("没有目标用户");
  let ticket = state.typingTickets?.[to]?.ticket;
  const age = Date.now() - (state.typingTickets?.[to]?.at || 0);
  if (!ticket || age > 20 * 60 * 60 * 1000) {
    const cfg = await apiPost(
      state.baseUrl,
      "ilink/bot/getconfig",
      { ilink_user_id: to, context_token: contextFor(state, to) || undefined },
      state.token,
      10_000,
    );
    ticket = cfg.typing_ticket || "";
    if (ticket) {
      updateState((s) => {
        s.typingTickets[to] = { ticket, at: Date.now() };
        return s;
      });
    }
  }
  if (!ticket) throw new Error("未拿到 typing_ticket");
  await apiPost(
    state.baseUrl,
    "ilink/bot/sendtyping",
    { ilink_user_id: to, typing_ticket: ticket, status: on ? TYPING.ON : TYPING.OFF },
    state.token,
    10_000,
  );
  return { to_user_id: to, typing: !!on };
}
