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

// ===== 初回メッセージ =====
function buildWelcomeMessage() {
  return `はじめまして！TAKARA AI Careerです。

このエージェントでは、あなたのキャリアに合わせて以下のサポートができます。

① 自己分析
② 向いている求人の方向性提案
③ 面接対策

「転職相談したい」「面接対策したい」など、自由に話しかけてください。

まずは、今どんな仕事をしているか教えてもらえますか？`;
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
async function showLoadingAnimation(chatId, seconds = 5) {
  try {
    await axios.post(
      "https://api.line.me/v2/bot/chat/loading/start",
      {
        chatId,
        loadingSeconds: seconds,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
      }
    );
  } catch (e) {}
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
      summary: "",
      interview_state: { active: false },
    };
    await supabase.from("line_ca_sessions").insert(init);
    return init;
  }

  return data;
}

async function saveSession(session) {
  await supabase.from("line_ca_sessions").upsert(session);
}

// ===== OpenAI（超軽量化） =====
async function getCareerAdvice(userMessage) {
  const res = await openai.responses.create({
    model: "gpt-5",
    input: `
あなたは優秀なキャリアアドバイザーです。
短く・的確に答えてください。

ユーザー: ${userMessage}
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
    if (event.type !== "message" || event.message.type !== "text") continue;

    const userId = event.source.userId;
    const userText = event.message.text;
    const replyToken = event.replyToken;

    const session = await getSession(userId);

    // ===== 初回だけ説明 =====
    if (!session.history || session.history.length === 0) {
      const welcome = buildWelcomeMessage();

      session.history = [{ role: "assistant", content: welcome }];
      await saveSession(session);

      await replyMessage(replyToken, welcome);
      continue;
    }

    // ===== 通常処理 =====
    await showLoadingAnimation(userId, 5);

    const aiReply = await getCareerAdvice(userText);

    session.history.push({ role: "user", content: userText });
    session.history.push({ role: "assistant", content: aiReply });

    await saveSession(session);

    await replyMessage(replyToken, "確認中です");
    await pushMessage(userId, aiReply);
  }
});

// ===== 起動 =====
app.listen(PORT, () => {
  console.log("Server running");
});