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

async function getCareerAdvice(userMessage) {
  const prompt = `
あなたはトップクラスのキャリアアドバイザーです。
人材業界（人材紹介、求人広告、HR SaaS）への転職支援に特化しています。

目的は「候補者の転職成功確率を最大化すること」です。

========================
【絶対ルール】
- 情報が足りない状態で結論を出してはいけない
- 必ずヒアリングを優先する
- 初回〜情報不足時は「質問のみ」でもよい
- アドバイスは情報が揃ってから出す

========================
【ヒアリング項目】
以下が揃うまで深い提案は禁止：

① 現職の役割
② 実績（数字）
③ 転職理由
④ 希望条件

========================
【会話ルール】
- 1回の返信で質問は1〜2個まで
- シンプルに聞く
- LINEで読みやすくする
- 長文にしない
- 250文字前後で返す
- 最後は質問で終える

========================
【情報不足時の対応】
- 必ず質問優先
- 「RA転職いいと思います」などの即結論は禁止
- まずは現状把握をする

========================
【情報が揃った後】
以下を簡潔に返す：
- 市場評価
- 強み
- 懸念点
- 次にやるべきこと
- 最後に1つ質問

========================
【文体】
- 丁寧
- 端的
- 実務的
- 偉そうにしない
- 友好的だが甘くしない

========================
【ユーザーの発言】
${userMessage}
  `.trim();

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5",
    input: prompt,
  });

  return response.output_text || "うまく回答できませんでした。今のご状況をもう少し具体的に教えてください。";
}

app.post("/webhook", async (req, res) => {
  const signature = req.headers["x-line-signature"];

  if (!validateLineSignature(req.rawBody, signature)) {
    return res.status(401).send("Invalid signature");
  }

  // LINEには先に200を返す
  res.sendStatus(200);

  const events = req.body.events || [];

  for (const event of events) {
    try {
      if (event.type === "message" && event.message.type === "text") {
        const userText = event.message.text;
        const userId = event.source && event.source.userId;

        if (!userId) continue;

        // まず擬似既読として即レス
        await replyMessage(event.replyToken, "少し考えています...");

        // AI回答生成
        const aiReply = await getCareerAdvice(userText);

        // その後pushで本回答
        await pushMessage(userId, aiReply);
      }
    } catch (e) {
      console.error(e?.response?.data || e.message || e);

      try {
        const userId = event.source && event.source.userId;
        if (userId) {
          await pushMessage(
            userId,
            "今ちょっと調子が悪いです。少し時間をおいて、もう一度送ってください。"
          );
        }
      } catch (_) {}
    }
  }
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});