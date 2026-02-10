/**
 * LINE + Gemini Vision Template (Reusable) + BetterLog Debug
 * - Secrets stored in Script Properties
 * - Prompt profiles selectable by "mode:<name>"
 *
 * Script Properties required:
 *  - LINE_TOKEN
 *  - GEMINI_API_KEY
 * Optional:
 *  - GEMINI_MODEL (default gemini-2.5-flash)
 *  - CURRENT_MODE  (stored by mode command)
 */

// ====== ② 🧠 PROMPT PROFILES ======
const PROMPT_PROFILES = {
  plt: [
    "ให้อ่านผลตรวจ CBC จากภาพนี้ และดึงเฉพาะค่า PLT (เกล็ดเลือด) เท่านั้น",
    "ตอบเป็นตัวเลขอย่างเดียว",
    "ห้ามมีหน่วย ห้ามมีคำอธิบาย ห้ามมีสัญลักษณ์",
    "ถ้าไม่พบให้ตอบ NA"
  ].join("\n"),

  summary: [
    "ช่วยอ่านข้อความ/สรุปใจความจากภาพนี้ให้หน่อย",
    "ถ้าเป็นเอกสารให้ดึงข้อมูลสำคัญออกมาเป็น bullet",
    "ตอบภาษาไทย กระชับ"
  ].join("\n"),

  ocr_all: [
    "ทำ OCR จากภาพนี้และถอดข้อความทั้งหมดออกมา",
    "จัดรูปแบบให้อ่านง่าย แบ่งบรรทัดตามต้นฉบับ"
  ].join("\n"),

  eye_check: [
    "ตรวจสอบจากภาพนี้ว่าคนในภาพ 'หลับตา' หรือ 'ลืมตา'",
    "ตอบได้แค่ 1 บรรทัดเท่านั้น",
    "ถ้าหลับตา ให้ตอบว่า: รูปนี้หลับตาครับ",
    "ถ้าลืมตา ให้ตอบว่า: รูปนี้ลืมตาครับ",
    "ถ้าไม่เห็นใบหน้าชัด/สรุปไม่ได้ ให้ตอบว่า: ตรวจไม่ชัดครับ"
  ].join("\n")
};

// ====== ③ 🎯 DEFAULT SETTINGS ======
const DEFAULT_MODE = "eye_check";
const GEMINI_MODEL_DEFAULT = "gemini-2.5-flash";
const MAX_OUTPUT_TOKENS = 512;
const TEMPERATURE = 0.2;

// ===============================
// ✅ BetterLog helpers (debugging)
// ===============================
function getLog_() {
  try {
    return BetterLog.useSpreadsheet();
  } catch (e) {
    return null; // do not break main flow
  }
}

function safeLog_(fnName, msg, obj) {
  const log = getLog_();
  if (!log) return;
  try {
    const payload = obj ? " " + JSON.stringify(obj) : "";
    log.info(`[${fnName}] ${msg}${payload}`);
  } catch (e) {
    // ignore
  }
}

// ====== WEBHOOK ENTRY ======
function doPost(e) {
  safeLog_("doPost", "incoming webhook", {
    hasPostData: !!e?.postData?.contents,
    bytes: e?.postData?.contents ? e.postData.contents.length : 0
  });

  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    safeLog_("doPost", "JSON parse failed", { error: String(err) });
    return ContentService.createTextOutput("BAD_JSON");
  }

  const events = body.events || [];
  safeLog_("doPost", "events parsed", { count: events.length });

  for (const ev of events) {
    if (ev.type !== "message") continue;

    const replyToken = ev.replyToken;
    const msg = ev.message;

    safeLog_("doPost", "message received", {
      type: msg?.type,
      messageId: msg?.id,
      textPreview: msg?.text ? String(msg.text).slice(0, 80) : "",
      currentMode: getCurrentMode_()
    });

    try {
      if (msg.type === "image") {
        handleImage_(replyToken, msg.id);
      } else if (msg.type === "text") {
        handleText_(replyToken, msg.text || "");
      } else {
        replyText_(replyToken, "ตอนนี้รองรับข้อความและรูปภาพครับ");
      }
    } catch (err) {
      safeLog_("doPost", "handler error", { error: String(err), stack: err?.stack || "" });
      replyText_(replyToken, "เกิดข้อผิดพลาด: " + err);
    }
  }

  return ContentService.createTextOutput("OK");
}

// ====== ⑤ 🖼️ IMAGE HANDLER ======
function handleImage_(replyToken, messageId) {
  const mode = getCurrentMode_();
  safeLog_("handleImage_", "start", { messageId, mode });

  const props = getProps_();
  const prompt = PROMPT_PROFILES[mode] || PROMPT_PROFILES[DEFAULT_MODE];

  safeLog_("handleImage_", "prompt selected", {
    mode,
    promptLen: String(prompt).length,
    promptHead: String(prompt).slice(0, 60)
  });

  const imgBlob = getLineContentBlob_(messageId, props.LINE_TOKEN);

  safeLog_("handleImage_", "image downloaded", {
    contentType: imgBlob.getContentType(),
    bytes: imgBlob.getBytes().length
  });

  const resultText = callGeminiVision_(imgBlob, prompt, props.GEMINI_API_KEY, props.GEMINI_MODEL);

  safeLog_("handleImage_", "gemini result", {
    resultLen: String(resultText).length,
    resultPreview: String(resultText).slice(0, 120)
  });

  replyText_(replyToken, resultText || "อ่านภาพไม่สำเร็จ ลองส่งภาพชัดขึ้นอีกนิดครับ");
}

// ====== ④ 💬 TEXT HANDLER ======
function handleText_(replyToken, text) {
  const t = (text || "").trim();
  safeLog_("handleText_", "text input", { text: t, currentMode: getCurrentMode_() });

  // mode:<name>
  const m = t.match(/^mode\s*:\s*([a-zA-Z0-9_]+)\s*$/);
  if (m) {
    const mode = m[1];
    safeLog_("handleText_", "mode command", { requestedMode: mode });

    if (!PROMPT_PROFILES[mode]) {
      safeLog_("handleText_", "mode not found", { requestedMode: mode, available: Object.keys(PROMPT_PROFILES) });
      return replyText_(replyToken, `ไม่พบโหมด ${mode}\nโหมดที่มี: ${Object.keys(PROMPT_PROFILES).join(", ")}`);
    }

    setCurrentMode_(mode);
    safeLog_("handleText_", "mode set", { newMode: mode });
    return replyText_(replyToken, `ตั้งค่าโหมดเป็น ${mode} แล้วครับ`);
  }

  // help
  if (t === "help" || t === "?") {
    safeLog_("handleText_", "help requested", {});
    return replyText_(
      replyToken,
      [
        "คำสั่งที่ใช้ได้:",
        `- mode:<name> เช่น mode:plt, mode:summary, mode:ocr_all, mode:eye_check`,
        `โหมดที่มี: ${Object.keys(PROMPT_PROFILES).join(", ")}`
      ].join("\n")
    );
  }

  // general
  replyText_(
    replyToken,
    `ส่งรูปมาได้เลยครับ (โหมดปัจจุบัน: ${getCurrentMode_()})\nพิมพ์ help เพื่อดูคำสั่ง`
  );
}

// ====== ⑤.1 🖼️ LINE: DOWNLOAD CONTENT ======
function getLineContentBlob_(messageId, lineToken) {
  safeLog_("getLineContentBlob_", "fetch line content", { messageId });

  const url = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
  const res = UrlFetchApp.fetch(url, {
    method: "get",
    headers: { Authorization: `Bearer ${lineToken}` },
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  safeLog_("getLineContentBlob_", "line response", { code });

  if (code !== 200) {
    safeLog_("getLineContentBlob_", "line fetch failed", {
      code,
      body: String(res.getContentText() || "").slice(0, 300)
    });
    throw new Error(`LINE content fetch failed: ${code} ${res.getContentText()}`);
  }

  const blob = res.getBlob();
  return blob.setName("line_image").setContentType(blob.getContentType() || "image/jpeg");
}

// ====== ⑥ 🤖 GEMINI: VISION CALL ======
function callGeminiVision_(imageBlob, promptText, apiKey, modelName) {
  const model = modelName || GEMINI_MODEL_DEFAULT;
  safeLog_("callGeminiVision_", "calling gemini", {
    model,
    mimeType: imageBlob.getContentType(),
    imgBytes: imageBlob.getBytes().length,
    promptLen: String(promptText).length
  });

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // DO NOT LOG base64 (sensitive + huge)
  const base64 = Utilities.base64Encode(imageBlob.getBytes());
  const mimeType = imageBlob.getContentType() || "image/jpeg";

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          { text: promptText },
          { inline_data: { mime_type: mimeType, data: base64 } }
        ]
      }
    ],
    generationConfig: {
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS
    }
  };

  const res = UrlFetchApp.fetch(endpoint, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  safeLog_("callGeminiVision_", "gemini response", { code });

  if (code !== 200) {
    safeLog_("callGeminiVision_", "gemini failed", {
      code,
      body: String(res.getContentText() || "").slice(0, 500)
    });
    throw new Error(`Gemini failed: ${code} ${res.getContentText()}`);
  }

  const json = JSON.parse(res.getContentText());
  const text = json?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";
  return (text || "").trim();
}

// ====== ⑦ 📢 LINE: REPLY ======
function replyText_(replyToken, text) {
  const props = getProps_();
  safeLog_("replyText_", "replying", {
    replyTokenShort: String(replyToken || "").slice(0, 6) + "...",
    textPreview: String(text || "").slice(0, 120)
  });

  const url = "https://api.line.me/v2/bot/message/reply";
  const payload = {
    replyToken,
    messages: [{ type: "text", text: String(text).slice(0, 5000) }]
  };

  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: `Bearer ${props.LINE_TOKEN}` },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  safeLog_("replyText_", "line reply response", { code: res.getResponseCode() });
}

// ====== ① 🔐 PROPERTIES ======
function getProps_() {
  const sp = PropertiesService.getScriptProperties();

  const LINE_TOKEN = sp.getProperty("LINE_TOKEN");
  const GEMINI_API_KEY = sp.getProperty("GEMINI_API_KEY");
  const GEMINI_MODEL = sp.getProperty("GEMINI_MODEL") || GEMINI_MODEL_DEFAULT;

  if (!LINE_TOKEN) throw new Error("Missing Script Property: LINE_TOKEN");
  if (!GEMINI_API_KEY) throw new Error("Missing Script Property: GEMINI_API_KEY");

  return { LINE_TOKEN, GEMINI_API_KEY, GEMINI_MODEL };
}

function getCurrentMode_() {
  const sp = PropertiesService.getScriptProperties();
  return sp.getProperty("CURRENT_MODE") || DEFAULT_MODE;
}

function setCurrentMode_(mode) {
  PropertiesService.getScriptProperties().setProperty("CURRENT_MODE", mode);
}
