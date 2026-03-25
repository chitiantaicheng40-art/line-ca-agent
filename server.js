require("dotenv").config();
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 10000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

async function getCareerAdvice(userMessage) {
  const prompt = `
あなたは一流のキャリアアドバイザーです。
特に人材業界（人材紹介、求人広告、HR SaaS）への転職支援に強いです。

以下のルールで、LINE向けに短く、わかりやすく、実務的に返答してください。

【ルール】
- 甘い評価は禁止
- 抽象論ではなく実務で使える内容にする
- 必要なら確認事項も伝える
- 200〜400文字程度で返す
- 最後に「次に教えてほしいこと」を1つだけ聞く

【ユーザーの相談】
${userMessage}
  `.trim();

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5",
    input: prompt,
  });

  return response.output_text || "うまく回答できませんでした。もう一度送ってください。";
}

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
        const userText = event.message.text;
        const aiReply = await getCareerAdvice(userText);
        await replyMessage(event.replyToken, aiReply);
      }
    } catch (e) {
      console.error(e?.response?.data || e.message || e);
      try {
        await replyMessage(event.replyToken, "今ちょっと調子が悪いです。少し時間をおいてもう一度送ってください。");
      } catch (_) {}
    }
  }
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});