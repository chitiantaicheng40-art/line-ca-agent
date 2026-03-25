require("dotenv").config();
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT;

// ===== OpenAI =====
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ===== Supabase =====
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ===== Middleware =====
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.get("/", (req, res) => {
  res.send("CA BOT OK");
});

// ===== LINE署名検証 =====
function validateLineSignature(rawBody, signature) {
  const hash = crypto
    .createHmac("SHA256", process.env.LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest("base64");
  return hash === signature;
}

// ===== LINE返信 =====
async function replyMessage(replyToken, text) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken,
      messages: [{ type: "text", text }],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    }
  );
}

async function pushMessage(userId, text) {
  await axios.post(
    "https://api.line.me/v2/bot/message/push",
    {
      to: userId,
      messages: [{ type: "text", text }],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    }
  );
}

async function sendThinking(replyToken) {
  await replyMessage(replyToken, "ありがとう、少しだけ整理しますね。");
}

// ===== プロフィール初期 =====
function defaultProfile() {
  return {
    current_job: null,
    industry: null,
    product: null,
    achievements: null,
    kpi: null,
    reason_for_change: null,
    desired_role: null,
    desired_industry: null,
    desired_salary: null,
    work_style: null,
    concerns: null,
  };
}

// ===== セッション取得 =====
async function getSession(userId) {
  const { data } = await supabase
    .from("line_ca_sessions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) {
    const initial = {
      user_id: userId,
      history: [],
      profile: defaultProfile(),
      summary: "",
      updated_at: new Date().toISOString(),
    };

    await supabase.from("line_ca_sessions").insert(initial);
    return initial;
  }

  return {
    user_id: data.user_id,
    history: data.history || [],
    profile: data.profile || defaultProfile(),
    summary: data.summary || "",
  };
}

// ===== 保存 =====
async function saveSession(session) {
  await supabase.from("line_ca_sessions").upsert({
    ...session,
    updated_at: new Date().toISOString(),
  });
}

// ===== JSON安全変換 =====
function safeJsonParse(text, fallback = {}) {
  try {
    return JSON.parse(text);
  } catch (_) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    try {
      return JSON.parse(match[0]);
    } catch (_) {
      return fallback;
    }
  }
}

// ===== プロフィール統合 =====
function mergeProfile(base, patch) {
  const next = { ...base };
  for (const key of Object.keys(next)) {
    if (patch[key]) next[key] = patch[key];
  }
  return next;
}

// ===== AIプロフィール抽出 =====
async function extractProfileWithAI(profile, text) {
  const prompt = `
この発言からキャリア情報をJSONで抽出してください。
不明はnull。

${text}
  `;

  const res = await openai.responses.create({
    model: "gpt-5",
    input: prompt,
  });

  const parsed = safeJsonParse(res.output_text || "{}");
  return mergeProfile(profile, parsed);
}

// ===== 要約 =====
async function summarize(summary, history) {
  const text = history.map(h => h.content).join("\n");

  const res = await openai.responses.create({
    model: "gpt-5",
    input: `要約して:\n${summary}\n${text}`,
  });

  return res.output_text;
}

// ===== 履歴圧縮 =====
async function compact(session) {
  if (session.history.length < 14) return;

  const old = session.history.slice(0, -8);
  session.summary = await summarize(session.summary, old);
  session.history = session.history.slice(-8);
}

// ===== AI応答 =====
async function getReply(session, userText) {
  const recent = session.history.slice(-8)
    .map(h => h.content)
    .join("\n");

  const prompt = `
あなたはトップキャリアアドバイザー。

要約:
${session.summary}

プロフィール:
${JSON.stringify(session.profile)}

会話:
${recent}

ユーザー:
${userText}

短く自然に答えろ。
`;

  const res = await openai.responses.create({
    model: "gpt-5",
    input: prompt,
  });

  return res.output_text;
}

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  const signature = req.headers["x-line-signature"];

  if (!validateLineSignature(req.rawBody, signature)) {
    return res.status(401).end();
  }

  res.sendStatus(200);

  for (const event of req.body.events) {
    try {
      if (event.type !== "message") continue;

      const userId = event.source.userId;
      const text = event.message.text;

      await sendThinking(event.replyToken);

      let session = await getSession(userId);

      session.profile = await extractProfileWithAI(session.profile, text);

      session.history.push({ role: "user", content: text });

      const reply = await getReply(session, text);

      session.history.push({ role: "assistant", content: reply });

      await compact(session);
      await saveSession(session);

      await pushMessage(userId, reply);

    } catch (e) {
      console.error(e);
      await pushMessage(event.source.userId, "ちょっと不安定🙏");
    }
  }
});

// ===== 起動 =====
app.listen(PORT, () => {
  console.log("Server running on " + PORT);
});