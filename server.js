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

async function sendThinking(replyToken) {
  await replyMessage(replyToken, "ありがとう、少しだけ整理しますね。");
}

// ===== セッション管理 =====
function defaultProfile() {
  return {
    current_job: null,
    industry: null,
    product: null,
    achievements: null,
    kpi: null,
    reason_for_change: null,
    desired_role: null,
    desired_industry: null,
    desired_salary: null,
    work_style: null,
    concerns: null,
  };
}

async function getSession(userId) {
  const { data, error } = await supabase
    .from("line_ca_sessions")
    .select("user_id, history, profile, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    const initial = {
      user_id: userId,
      history: [],
      profile: defaultProfile(),
      updated_at: new Date().toISOString(),
    };

    const { error: insertError } = await supabase
      .from("line_ca_sessions")
      .insert(initial);

    if (insertError) throw insertError;

    return initial;
  }

  return {
    user_id: data.user_id,
    history: Array.isArray(data.history) ? data.history : [],
    profile: data.profile || defaultProfile(),
    updated_at: data.updated_at,
  };
}

async function saveSession(session) {
  const { error } = await supabase.from("line_ca_sessions").upsert({
    user_id: session.user_id,
    history: session.history,
    profile: session.profile,
    updated_at: new Date().toISOString(),
  });

  if (error) throw error;
}

function trimHistory(history, maxItems = 20) {
  if (history.length <= maxItems) return history;
  return history.slice(-maxItems);
}

// ===== 軽いプロフィール抽出 =====
function updateProfileFromUserMessage(profile, text) {
  const msg = (text || "").trim();

  if (!profile.current_job) {
    if (/法人営業|個人営業|営業|販売|接客|RA|CA|人事|マーケ|CS|エンジニア|事務/.test(msg)) {
      profile.current_job = msg;
    }
  }

  if (!profile.industry) {
    if (/IT|SaaS|人材|広告|製造|医療|不動産|金融|物流|メーカー/.test(msg)) {
      profile.industry = msg;
    }
  }

  if (!profile.product) {
    if (/商材|プロダクト|サービス|SaaS|求人広告|人材紹介|IT商材/.test(msg)) {
      profile.product = msg;
    }
  }

  if (!profile.achievements) {
    if (/\d/.test(msg) && /件|円|万|%|社|名|達成|売上|粗利|受注|契約/.test(msg)) {
      profile.achievements = msg;
    }
  }

  if (!profile.kpi) {
    if (/KPI|目標|達成率|アポ|受注|商談|売上/.test(msg)) {
      profile.kpi = msg;
    }
  }

  if (!profile.reason_for_change) {
    if (/転職|辞めたい|やめたい|年収|残業|働き方|将来|キャリア|評価|不満/.test(msg)) {
      profile.reason_for_change = msg;
    }
  }

  if (!profile.desired_role) {
    if (/RA|CA|両面|人材営業|求人広告|HR SaaS/.test(msg)) {
      profile.desired_role = msg;
    }
  }

  if (!profile.desired_industry) {
    if (/人材業界|IT業界|SaaS|広告|製造|医療/.test(msg)) {
      profile.desired_industry = msg;
    }
  }

  if (!profile.desired_salary) {
    if (/年収|万円|希望年収/.test(msg)) {
      profile.desired_salary = msg;
    }
  }

  if (!profile.work_style) {
    if (/リモート|在宅|土日|勤務地|働き方/.test(msg)) {
      profile.work_style = msg;
    }
  }

  if (!profile.concerns) {
    if (/不安|心配|懸念|自信がない|迷って/.test(msg)) {
      profile.concerns = msg;
    }
  }

  return profile;
}

// ===== 何を聞くか決める =====
function pickNextQuestion(profile) {
  if (!profile.current_job) {
    return "今のお仕事って、どんな役割を担当していますか？";
  }
  if (!profile.achievements && !profile.kpi) {
    return "直近の実績って、数字でいうとどんな感じですか？";
  }
  if (!profile.reason_for_change) {
    return "転職したい理由って、いちばん大きいのは何ですか？";
  }
  if (!profile.desired_role) {
    return "次はどんな職種を考えていますか？ RA・CA・両面あたりですか？";
  }
  if (!profile.desired_salary && !profile.work_style) {
    return "年収や働き方で、譲れない条件はありますか？";
  }
  return null;
}

// ===== AI応答 =====
async function getCareerAdvice(session, userMessage) {
  const historyText = session.history
    .map((m) => `${m.role === "user" ? "ユーザー" : "CA"}: ${m.content}`)
    .join("\n");

  const profile = session.profile;
  const profileText = `
現職: ${profile.current_job || "未取得"}
業界: ${profile.industry || "未取得"}
商材: ${profile.product || "未取得"}
実績: ${profile.achievements || "未取得"}
KPI: ${profile.kpi || "未取得"}
転職理由: ${profile.reason_for_change || "未取得"}
希望職種: ${profile.desired_role || "未取得"}
希望業界: ${profile.desired_industry || "未取得"}
希望年収: ${profile.desired_salary || "未取得"}
働き方条件: ${profile.work_style || "未取得"}
不安点: ${profile.concerns || "未取得"}
  `.trim();

  const nextQuestion = pickNextQuestion(profile);

  const prompt = `
あなたは、人材業界に強いトップクラスのキャリアアドバイザーです。
LINEで相談対応しており、短く、親しみやすく、でも浅くなく返してください。

【最重要ルール】
- 前の会話を必ず踏まえる
- 取得済み情報は繰り返し聞かない
- 1回の返答は2〜4文
- 長文禁止
- 質問は1回につき1つだけ
- 情報不足なら結論を急がない
- ただし相手が答えやすいように軽く方向づけはしてよい
- 親しみやすいが、馴れ馴れしすぎない
- 上から目線禁止
- コンサル口調すぎる固い文章禁止

【返し方】
- 1文目: 軽い受け止め or 共感
- 2文目: 必要なら短い見立て
- 3文目: 次に聞くこと
- 最後は自然な質問で終える

【情報が十分そろってきた場合】
- 短く結論
- 理由を一言
- 次アクションを一言
- 最後に1質問

【絶対NG】
- 箇条書き連発
- 長文
- 毎回ゼロから始める
- 同じ質問の繰り返し

【これまでの会話】
${historyText || "なし"}

【把握済みプロフィール】
${profileText}

【今回のユーザー発言】
${userMessage}

【次に聞く候補】
${nextQuestion || "必要なら自然に深掘りしてください"}
  `.trim();

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5",
    input: prompt,
  });

  return response.output_text || "ありがとう。もう少しだけ詳しく教えてもらえますか？";
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

        await sendThinking(event.replyToken);

        const session = await getSession(userId);

        updateProfileFromUserMessage(session.profile, userText);

        session.history.push({ role: "user", content: userText });
        session.history = trimHistory(session.history, 20);

        const aiReply = await getCareerAdvice(session, userText);

        session.history.push({ role: "assistant", content: aiReply });
        session.history = trimHistory(session.history, 20);

        await saveSession(session);

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

// ===== Render対応 =====
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port " + PORT);
});