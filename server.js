require("dotenv").config();
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 10000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

app.get("/", (req, res) => res.send("OK"));

// ===== 初回メッセージ =====
function buildWelcomeMessage() {
  return `はじめまして！TAKARA AI Careerです。

できること👇
① 自己分析
② 求人方向性提案
③ 面接対策
④ 求人チェック
⑤ 実在求人の提案

例👇
「転職相談したい」
「この求人どう？」
「RA 東京 600万以上」

まずは今のお仕事を教えてください！`;
}

// ===== LINE署名 =====
function validateLineSignature(rawBody, signature) {
  const hash = crypto
    .createHmac("SHA256", process.env.LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest("base64");
  return hash === signature;
}

// ===== LINE送信 =====
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

// ===== ローディング =====
async function showLoadingAnimation(chatId) {
  try {
    await axios.post(
      "https://api.line.me/v2/bot/chat/loading/start",
      {
        chatId,
        loadingSeconds: 5,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
      }
    );
  } catch {}
}

// ===== セッション =====
async function getSession(userId) {
  const { data } = await supabase
    .from("line_ca_sessions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) {
    const init = {
      user_id: userId,
      history: [],
      profile: {},
    };
    await supabase.from("line_ca_sessions").insert(init);
    return init;
  }

  return data;
}

async function saveSession(session) {
  await supabase.from("line_ca_sessions").upsert(session);
}

// ===== 求人検索トリガー =====
function isJobSearchMessage(text) {
  return /求人|仕事探し|年収|RA|東京|探して/.test(text);
}

// ===== 仮求人（後でAPIに差し替え） =====
function getMockJobs() {
  return [
    {
      title: "IT人材紹介 RA",
      company: "ROSCA",
      salary: "500〜900万円",
      location: "東京",
      description: "IT人材の法人営業、既存深耕＋新規開拓",
    },
    {
      title: "RA/CA両面",
      company: "Quicker",
      salary: "500〜800万円",
      location: "東京",
      description: "人材紹介、RA/CA両面対応",
    },
    {
      title: "採用人事",
      company: "グラファー",
      salary: "480〜840万円",
      location: "東京",
      description: "採用・面接・戦略",
    },
  ];
}

// ===== 求人レコメンド =====
async function recommendJobs(session, condition) {
  const jobs = getMockJobs();

  const prompt = `
あなたは世界一のリクルーティングアドバイザーです。

【候補者】
${JSON.stringify(session.profile)}

【条件】
${condition}

【求人】
${JSON.stringify(jobs)}

【出力】
- 1位〜3位
- 理由
- 最も受けるべき求人を断定
- 最後に質問1つ
`;

  const res = await openai.responses.create({
    model: "gpt-5",
    input: prompt,
  });

  return res.output_text;
}

// ===== 通常相談 =====
async function getAdvice(text) {
  const res = await openai.responses.create({
    model: "gpt-5",
    input: `
あなたはキャリアアドバイザーです。
短く実務的に答えてください。

${text}
`,
  });

  return res.output_text;
}

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  const signature = req.headers["x-line-signature"];
  if (!validateLineSignature(req.rawBody, signature)) {
    return res.status(401).send("Invalid signature");
  }

  res.sendStatus(200);

  const events = req.body.events || [];

  for (const event of events) {
    if (event.type !== "message") continue;

    const userId = event.source.userId;
    const userText = event.message.text;
    const replyToken = event.replyToken;

    const session = await getSession(userId);

    // ===== 初回 =====
    if (!session.history || session.history.length === 0) {
      const welcome = buildWelcomeMessage();
      session.history = [{ role: "assistant", content: welcome }];
      await saveSession(session);
      await replyMessage(replyToken, welcome);
      continue;
    }

    await showLoadingAnimation(userId);

    // ===== 求人検索 =====
    if (isJobSearchMessage(userText)) {
      const result = await recommendJobs(session, userText);

      await replyMessage(replyToken, "確認中です");
      await pushMessage(userId, result);
      continue;
    }

    // ===== 通常 =====
    const reply = await getAdvice(userText);

    session.history.push({ role: "user", content: userText });
    session.history.push({ role: "assistant", content: reply });

    await saveSession(session);

    await replyMessage(replyToken, "確認中です");
    await pushMessage(userId, reply);
  }
});

// ===== 起動 =====
app.listen(PORT, () => {
  console.log("Server running");
});