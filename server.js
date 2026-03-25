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

// ===== reply（即時返信用）=====
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

// ===== push（後追い返信）=====
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

// ===== AI（精度強化ver）=====
async function getCareerAdvice(userMessage) {
  const prompt = `
あなたはトップ1%のリクルーティングアドバイザーです。
人材紹介（RA/CA）、HR SaaS、求人広告の転職支援に特化しています。

【目的】
・面接通過率を最大化する
・年収アップを実現する
・意思決定を前に進める

【ルール】
・甘いことは言わない（現実ベース）
・抽象論禁止（必ず実務レベル）
・数字・KPI・具体行動に落とす
・構造的に整理（結論→理由→アクション）
・200〜400文字
・最後に必ず「次に教えてほしいこと」を1つ聞く

【評価観点】
・再現性（その人が他社でも成果出せるか）
・KPI耐性（数字で語れるか）
・営業タイプ適合
・転職市場価値

【ユーザーの相談】
${userMessage}
  `.trim();

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5",
    input: prompt,
  });

  return response.output_text || "うまく回答できませんでした。もう一度送ってください。";
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

        // ===== ① 即レス（既読＋thinking）=====
        await replyMessage(
          event.replyToken,
          "確認しました。少しだけお待ちください（考えています…）"
        );

        // ===== ② AI生成 =====
        const aiReply = await getCareerAdvice(userText);

        // ===== ③ 本回答（push）=====
        await pushMessage(userId, aiReply);
      }
    } catch (e) {
      console.error(e?.response?.data || e.message || e);

      try {
        await pushMessage(
          event.source.userId,
          "今ちょっと調子が悪いです。少し時間をおいてもう一度送ってください。"
        );
      } catch (_) {}
    }
  }
});

// ===== 起動 =====
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});