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

// ===== 会話履歴保存（簡易版：メモリ）=====
// Render再起動で消える。まずはMVPとして使う。
const userSessions = new Map();

function getSession(userId) {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {
      history: [],
      profile: {
        currentJob: null,
        achievement: null,
        reason: null,
        desiredRole: null,
        workStyle: null,
      },
      updatedAt: Date.now(),
    });
  }
  return userSessions.get(userId);
}

function trimHistory(history, maxItems = 12) {
  if (history.length <= maxItems) return history;
  return history.slice(history.length - maxItems);
}

function updateProfileFromUserMessage(profile, text) {
  const msg = (text || "").trim();

  if (!profile.currentJob) {
    if (
      /営業|法人営業|個人営業|販売|接客|RA|CA|人材|エンジニア|事務|マーケ|CS|カスタマーサクセス/.test(
        msg
      )
    ) {
      profile.currentJob = msg;
    }
  }

  if (!profile.achievement) {
    if (/\d/.test(msg) && /件|円|万|%|社|名|達成|売上|KPI|目標/.test(msg)) {
      profile.achievement = msg;
    }
  }

  if (!profile.reason) {
    if (
      /転職|辞めたい|やめたい|不満|年収|残業|評価|将来|キャリア|働き方|人間関係/.test(
        msg
      )
    ) {
      profile.reason = msg;
    }
  }

  if (!profile.desiredRole) {
    if (/RA|CA|両面|求人広告|HR SaaS|人材紹介|人材営業/.test(msg)) {
      profile.desiredRole = msg;
    }
  }

  if (!profile.workStyle) {
    if (/年収|リモート|在宅|土日|働き方|勤務地/.test(msg)) {
      profile.workStyle = msg;
    }
  }

  return profile;
}

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

// ===== 会話型CA AI（履歴つき）=====
async function getCareerAdvice(userId, userMessage) {
  const session = getSession(userId);
  session.updatedAt = Date.now();

  updateProfileFromUserMessage(session.profile, userMessage);

  const historyText = session.history
    .map((item) => `${item.role === "user" ? "ユーザー" : "CA"}: ${item.text}`)
    .join("\n");

  const profileText = `
現職の仕事内容: ${session.profile.currentJob || "未取得"}
実績: ${session.profile.achievement || "未取得"}
転職理由: ${session.profile.reason || "未取得"}
希望職種: ${session.profile.desiredRole || "未取得"}
希望条件・働き方: ${session.profile.workStyle || "未取得"}
  `.trim();

  const prompt = `
あなたは、人材業界に強いキャリアアドバイザーです。
会話相手に寄り添いながら、短く・端的に・親しみやすく話します。
前の会話を必ず踏まえ、同じ質問をむやみに繰り返さないでください。

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
・情報が足りなければ結論を出しすぎない
・必ず最後は自然な1つの質問で終える
・過去の会話で取得済みの情報は、なるべく再度聞かない
・ユーザーの温度感に合わせる
・同じトーンを保つ

【ヒアリング項目】
必要に応じて順番に集める
1. 現職の仕事内容
2. 実績（数字）
3. 転職理由
4. 希望職種
5. 年収や働き方

【情報が少ない時】
・共感 → 1つだけ質問

【情報が揃ってきた時】
・短く結論
・理由を一言
・次アクションを一言
・最後に1質問

【NG】
・長文
・質問2個以上
・固すぎるコンサル文
・すでに聞いたことを繰り返す
・情報があるのに毎回ゼロから始める

【これまでの会話】
${historyText || "まだ会話履歴なし"}

【把握済みプロフィール】
${profileText}

【今回のユーザー発言】
${userMessage}
  `.trim();

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5",
    input: prompt,
  });

  const answer =
    response.output_text || "ありがとう。もう少しだけ詳しく教えてもらえますか？";

  session.history.push({ role: "user", text: userMessage });
  session.history.push({ role: "assistant", text: answer });
  session.history = trimHistory(session.history, 12);

  return answer;
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
        const userId = event.source?.userId;

        if (!userId) continue;

        await replyMessage(event.replyToken, "ありがとう、少しだけ整理しますね。");

        const aiReply = await getCareerAdvice(userId, userText);

        await pushMessage(userId, aiReply);
      }
    } catch (e) {
      console.error(e?.response?.data || e.message || e);

      try {
        const userId = event.source?.userId;
        if (userId) {
          await pushMessage(
            userId,
            "ごめん、今ちょっと調子悪いです。少し時間おいてもう一度送ってもらえますか？"
          );
        }
      } catch (_) {}
    }
  }
});

// ===== 起動 =====
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});