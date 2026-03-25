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

function validateLineSignature(rawBody, signature) {
  const hash = crypto
    .createHmac("SHA256", process.env.LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest("base64");
  return hash === signature;
}

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
        "Content-Type": "application/json",
      },
    }
  );
}

// ===== 履歴取得 =====
async function getHistory(userId) {
  const { data } = await supabase
    .from("line_ca_sessions")
    .select("history")
    .eq("user_id", userId)
    .single();

  return data?.history || [];
}

// ===== 履歴保存 =====
async function saveHistory(userId, history) {
  await supabase.from("line_ca_sessions").upsert({
    user_id: userId,
    history,
  });
}

// ===== AI =====
async function getCareerAdvice(userMessage, history) {
  const prompt = `
あなたは人材業界に強いキャリアアドバイザーです。
LINEで会話している前提で、短く・親しみやすく・実務的に答えてください。

【ルール】
- 2〜4行で簡潔
- フランクだけどプロ
- 抽象論NG（具体）
- 最後に軽く質問1つ

【過去の会話】
${history.map((h) => h.role + ":" + h.content).join("\n")}

【今回の相談】
${userMessage}
  `.trim();

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5",
    input: prompt,
  });

  return response.output_text || "うまく回答できませんでした。";
}

// ===== webhook =====
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
        const userId = event.source.userId;
        const userText = event.message.text;

        // 履歴取得
        let history = await getHistory(userId);

        // 追加
        history.push({ role: "user", content: userText });

        // AI生成
        const aiReply = await getCareerAdvice(userText, history);

        // 履歴保存
        history.push({ role: "assistant", content: aiReply });
        history = history.slice(-20); // 最新20件だけ保持
        await saveHistory(userId, history);

        // 返信
        await replyMessage(event.replyToken, aiReply);
      }
    } catch (e) {
      console.error(e);
      try {
        await replyMessage(event.replyToken, "今ちょっと不安定です🙏 少し待ってもう一度！");
      } catch (_) {}
    }
  }
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});