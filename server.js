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

// ===== thinking表示 =====
async function sendThinking(replyToken) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken,
      messages: [{ type: "text", text: "ありがとう、少しだけ整理しますね。" }],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// ===== push送信 =====
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
        "Content-Type": "application/json",
      },
    }
  );
}

// ===== 履歴取得 =====
async function getHistory(userId) {
  const { data, error } = await supabase
    .from("line_ca_sessions")
    .select("history")
    .eq("user_id", userId)
    .single();

  if (error && error.code !== "PGRST116") {
    throw error;
  }

  return data?.history || [];
}

// ===== 履歴保存 =====
async function saveHistory(userId, history) {
  const { error } = await supabase.from("line_ca_sessions").upsert({
    user_id: userId,
    history,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw error;
  }
}

// ===== AI応答 =====
async function getCareerAdvice(userMessage, history) {
  const prompt = `
あなたは人材業界に強いキャリアアドバイザーです。
LINEで会話している前提で、短く・親しみやすく・実務的に答えてください。

【スタイル】
- 短く
- 端的に
- フレンドリー
- 2〜4文
- 無駄な説明なし
- 会話を続ける
- 1回で質問は1つだけ

【ルール】
- 甘い評価は禁止
- 実務ベースで話す
- 情報が足りない時は結論を急がない
- 最後に自然な質問を1つ入れる
- 同じ質問を何度も繰り返さない

【過去の会話】
${history.map((h) => `${h.role}: ${h.content}`).join("\n")}

【今回の相談】
${userMessage}
  `.trim();

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5",
    input: prompt,
  });

  return response.output_text || "うまく答えられなかったです。もう少し詳しく教えてください🙏";
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
    try {
      if (event.type === "message" && event.message.type === "text") {
        const userId = event.source?.userId;
        const userText = event.message.text;

        if (!userId) continue;

        // ① 即レス
        await sendThinking(event.replyToken);

        // ② 履歴取得
        let history = await getHistory(userId);

        // ③ ユーザー発言追加
        history.push({ role: "user", content: userText });

        // 最新20件まで
        history = history.slice(-20);

        // ④ AI応答生成
        const aiReply = await getCareerAdvice(userText, history);

        // ⑤ AI発言も保存
        history.push({ role: "assistant", content: aiReply });
        history = history.slice(-20);

        // ⑥ 保存
        await saveHistory(userId, history);

        // ⑦ pushで本回答
        await pushMessage(userId, aiReply);
      }
    } catch (e) {
      console.error("Webhook error:", e?.response?.data || e.message || e);

      try {
        const userId = event.source?.userId;
        if (userId) {
          await pushMessage(
            userId,
            "ごめん、今ちょっと不安定です。少し時間をおいてもう一度送ってください🙏"
          );
        }
      } catch (_) {}
    }
  }
});

// ===== 起動（Render対応）=====
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port " + PORT);
});