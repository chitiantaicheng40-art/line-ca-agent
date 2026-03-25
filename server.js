require("dotenv").config();
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 10000;

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

// ===== 既読（Push APIを利用）=====
async function sendSeen(userId) {
  try {
    await axios.post(
      "https://api.line.me/v2/bot/message/push",
      {
        to: userId,
        messages: [{ type: "text", text: "👀" }],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (e) {
    console.log("seen error:", e?.response?.data || e.message);
  }
}

// ===== thinking表示 =====
async function sendThinking(replyToken) {
  try {
    await axios.post(
      "https://api.line.me/v2/bot/message/reply",
      {
        replyToken,
        messages: [{ type: "text", text: "💭 考え中..." }],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (e) {}
}

// ===== 通常返信 =====
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
    .from("messages")
    .select("role, content")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(10);

  return data || [];
}

// ===== 履歴保存 =====
async function saveMessage(userId, role, content) {
  await supabase.from("messages").insert([
    {
      user_id: userId,
      role,
      content,
    },
  ]);
}

// ===== AI応答 =====
async function getCareerAdvice(userId, userMessage) {
  const history = await getHistory(userId);

  const messages = [
    {
      role: "system",
      content: `
あなたは優秀なキャリアアドバイザーです。
人材紹介（RA/CA）に強いです。

【スタイル】
- 短く
- 端的に
- フレンドリー
- 1〜3文
- 無駄な説明なし
- 会話を続ける

【ルール】
- 甘い評価は禁止
- 実務ベースで話す
- 必要なら軽く質問する
      `,
    },
    ...history,
    {
      role: "user",
      content: userMessage,
    },
  ];

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5",
    input: messages,
  });

  return response.output_text || "うまく答えられなかった。もう一度教えて🙏";
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
        const userId = event.source.userId;
        const userText = event.message.text;

        // 既読
        await sendSeen(userId);

        // thinking
        await sendThinking(event.replyToken);

        // 履歴保存（ユーザー）
        await saveMessage(userId, "user", userText);

        // AI応答
        const aiReply = await getCareerAdvice(userId, userText);

        // 履歴保存（AI）
        await saveMessage(userId, "assistant", aiReply);

        // 本返信
        await replyMessage(event.replyToken, aiReply);
      }
    } catch (e) {
      console.error(e?.response?.data || e.message || e);
      try {
        await replyMessage(
          event.replyToken,
          "ごめん🙏 ちょっと調子悪い。もう一回送って！"
        );
      } catch (_) {}
    }
  }
});

// ===== Render対応 =====
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port " + PORT);
});