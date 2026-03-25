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

// ===== LINE署名検証 =====
function validateLineSignature(rawBody, signature) {
  const hash = crypto
    .createHmac("SHA256", process.env.LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest("base64");
  return hash === signature;
}

// ===== reply（即レス）=====
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

// ===== push（後から本回答）=====
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

// ===== 会話型CA AI =====
async function getCareerAdvice(userMessage) {
  const prompt = `
あなたは、人材業界に強いキャリアアドバイザーです。
会話相手に寄り添いながら、短く・端的に・親しみやすく話します。

【目的】
・相手が話しやすい空気をつくる
・少しずつ情報を集める
・最終的に転職成功につながる助言をする

【話し方】
・2〜4文で返す
・短く、シンプルに
・親しみやすいが軽すぎない
・上から目線NG
・LINEで読みやすい文章
・難しい言葉は使いすぎない

【会話ルール】
・まずヒアリング優先
・1回の質問は1つだけ
・情報が足りなければ結論を出さない
・必ず最後に1つ質問する

【ヒアリング項目（順番に集める）】
1. 現職の仕事内容
2. 実績（数字）
3. 転職理由
4. 希望職種
5. 年収や働き方

【情報が少ない時】
・共感 → 質問

【情報が揃ってきた時】
・結論 → 理由 → 次アクション → 質問

【NG】
・長文
・質問2個以上
・コンサルっぽすぎる固い文章

【ユーザーの発言】
${userMessage}
  `.trim();

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5",
    input: prompt,
  });

  return response.output_text || "ありがとう、もう少し詳しく教えてもらえますか？";
}

// ===== メイン処理 =====
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
        const userId = event.source.userId;

        // ===== ① 既読＋thinking =====
        await replyMessage(
          event.replyToken,
          "ありがとう、少しだけ整理しますね。"
        );

        // ===== ② AI生成 =====
        const aiReply = await getCareerAdvice(userText);

        // ===== ③ 本回答 =====
        await pushMessage(userId, aiReply);
      }
    } catch (e) {
      console.error(e?.response?.data || e.message || e);

      try {
        await pushMessage(
          event.source.userId,
          "ごめん、今ちょっと調子悪いです。少し時間おいてもう一度送ってもらえますか？"
        );
      } catch (_) {}
    }
  }
});

// ===== 起動 =====
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});