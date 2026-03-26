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

// ===== 初回メッセージ =====
function buildWelcomeMessage() {
  return `はじめまして！TAKARA AI Careerです。

このエージェントでは、あなたのキャリアに合わせて以下のサポートができます。

① 自己分析
② 向いている求人の方向性提案
③ 面接対策
④ この求人どう？の適合チェック
⑤ 実在求人の提案

たとえば
・「転職相談したい」
・「面接対策したい」
・「この求人どう？」
・「RA 東京 600万以上」

など、自由に送ってください。

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

async function showLoadingAnimation(chatId, seconds = 5) {
  try {
    await axios.post(
      "https://api.line.me/v2/bot/chat/loading/start",
      {
        chatId,
        loadingSeconds: Math.max(5, Math.min(seconds, 60)),
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (e) {
    console.error("Loading animation error:", e?.response?.data || e.message || e);
  }
}

// ===== 初期値 =====
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

// ===== Utility =====
function safeJsonParse(text, fallback = {}) {
  try {
    return JSON.parse(text);
  } catch (_) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    try {
      return JSON.parse(match[0]);
    } catch (_) {
      return fallback;
    }
  }
}

function mergeProfile(base, patch) {
  const next = { ...base };
  for (const key of Object.keys(next)) {
    const value = patch?.[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    next[key] = value;
  }
  return next;
}

function recentHistoryText(history, maxItems = 8) {
  return history
    .slice(-maxItems)
    .map((m) => `${m.role === "user" ? "ユーザー" : "CA"}: ${m.content}`)
    .join("\n");
}

// ===== セッション =====
async function getSession(userId) {
  const { data, error } = await supabase
    .from("line_ca_sessions")
    .select("user_id, history, profile, summary, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    const init = {
      user_id: userId,
      history: [],
      profile: defaultProfile(),
      summary: "",
      updated_at: new Date().toISOString(),
    };

    const { error: insertError } = await supabase
      .from("line_ca_sessions")
      .insert(init);

    if (insertError) throw insertError;

    return init;
  }

  return {
    user_id: data.user_id,
    history: Array.isArray(data.history) ? data.history : [],
    profile: data.profile || defaultProfile(),
    summary: data.summary || "",
    updated_at: data.updated_at,
  };
}

async function saveSession(session) {
  const { error } = await supabase.from("line_ca_sessions").upsert({
    user_id: session.user_id,
    history: session.history,
    profile: session.profile,
    summary: session.summary || "",
    updated_at: new Date().toISOString(),
  });

  if (error) throw error;
}

// ===== プロフィール抽出 =====
function updateProfileFromUserMessage(profile, text) {
  const msg = (text || "").trim();

  if (!profile.current_job) {
    if (/法人営業|個人営業|営業|販売|接客|RA|CA|人事|マーケ|CS|カスタマーサクセス|エンジニア|事務/.test(msg)) {
      profile.current_job = msg;
    }
  }

  if (!profile.industry) {
    if (/IT|SaaS|人材|広告|製造|医療|不動産|金融|物流|メーカー|HR/.test(msg)) {
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
    if (/転職|辞めたい|やめたい|年収|残業|働き方|将来|キャリア|評価|不満|提案の幅/.test(msg)) {
      profile.reason_for_change = msg;
    }
  }

  if (!profile.desired_role) {
    if (/RA|CA|両面|人材営業|求人広告|HR SaaS|エンタープライズ営業|コンサル|カスタマーサクセス|CS/.test(msg)) {
      profile.desired_role = msg;
    }
  }

  if (!profile.desired_industry) {
    if (/人材業界|IT業界|SaaS|広告|製造|医療|HR/.test(msg)) {
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

async function extractProfileWithAI(currentProfile, userMessage) {
  const prompt = `
あなたはキャリア面談の情報抽出アシスタントです。
以下のユーザー発言から、プロフィール項目をJSONで抽出してください。
わからない項目は null のままにしてください。
既存情報より明らかに具体的な場合だけ上書きしてよいです。
説明文は不要、JSONのみ返してください。

【既存プロフィール】
${JSON.stringify(currentProfile, null, 2)}

【今回の発言】
${userMessage}

【出力形式】
{
  "current_job": null,
  "industry": null,
  "product": null,
  "achievements": null,
  "kpi": null,
  "reason_for_change": null,
  "desired_role": null,
  "desired_industry": null,
  "desired_salary": null,
  "work_style": null,
  "concerns": null
}
  `.trim();

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5",
    input: prompt,
  });

  const parsed = safeJsonParse(response.output_text || "{}", {});
  return mergeProfile(currentProfile, parsed);
}

// ===== 通常相談 =====
async function getCareerAdvice(session, userMessage) {
  const historyText = recentHistoryText(session.history, 8);
  const profile = session.profile;

  const prompt = `
あなたは、人材業界に強いトップクラスのキャリアアドバイザーです。
LINEで相談対応しており、短く、親しみやすく、でも浅くなく返してください。

【最重要】
- summaryを最優先で踏まえる
- 直近会話も踏まえる
- 取得済み情報は繰り返し聞かない
- 情報が足りないなら無理に結論を断定しない
- ただし方向性が見えるなら一言で示す
- 箇条書き禁止
- 3〜4文で返す

【これまでの要約】
${session.summary || "まだ要約なし"}

【把握済みプロフィール】
${JSON.stringify(profile, null, 2)}

【直近の会話】
${historyText || "なし"}

【今回のユーザー発言】
${userMessage}
  `.trim();

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5",
    input: prompt,
  });

  return response.output_text || "ありがとう。もう少しだけ詳しく教えてもらえますか？";
}

// ===== 求人検索 =====
function isJobSearchMessage(text) {
  return /求人探して|求人教えて|仕事探し|求人提案|RA|CA|SaaS|東京|大阪|年収|万円|フルリモート|在宅/.test(
    text || ""
  );
}

function parseJobSearchCondition(text) {
  const raw = text || "";
  const salaryMatch = raw.match(/(\d{3,4})\s*万/);
  const minSalary = salaryMatch ? Number(salaryMatch[1]) : null;

  let location = null;
  if (/東京/.test(raw)) location = "東京";
  else if (/大阪/.test(raw)) location = "大阪";
  else if (/福岡/.test(raw)) location = "福岡";

  let jobType = null;
  if (/RA/.test(raw)) jobType = "RA";
  else if (/CA/.test(raw)) jobType = "CA";
  else if (/両面/.test(raw)) jobType = "RA/CA";
  else if (/人事/.test(raw)) jobType = "採用人事";

  let keyword = null;
  if (/SaaS/i.test(raw)) keyword = "SaaS";
  else if (/人材/.test(raw)) keyword = "人材";
  else if (/IT/.test(raw)) keyword = "IT";

  return {
    raw,
    minSalary,
    location,
    jobType,
    keyword,
  };
}

async function searchJobsInSupabase(condition) {
  let query = supabase
    .from("jobs")
    .select("*")
    .eq("is_active", true)
    .order("salary_max", { ascending: false })
    .limit(10);

  if (condition.location) {
    query = query.ilike("location", `%${condition.location}%`);
  }

  if (condition.jobType) {
    query = query.ilike("job_type", `%${condition.jobType}%`);
  }

  if (condition.minSalary) {
    query = query.gte("salary_max", condition.minSalary);
  }

  const { data, error } = await query;
  if (error) throw error;

  let jobs = data || [];

  if (condition.keyword) {
    jobs = jobs.filter((job) => {
      const blob = [
        job.title,
        job.company,
        job.job_type,
        job.industry,
        job.description,
        job.requirements,
      ]
        .filter(Boolean)
        .join(" ");
      return blob.toLowerCase().includes(condition.keyword.toLowerCase());
    });
  }

  return jobs.slice(0, 3);
}

async function recommendRealJobs(session, userCondition, jobs) {
  const profile = session.profile || defaultProfile();

  const prompt = `
あなたは世界一のリクルーティングアドバイザーです。
候補者プロフィールと求人一覧を比較し、どの求人を優先して受けるべきか判断してください。

【候補者プロフィール】
${JSON.stringify(profile, null, 2)}

【会話要約】
${session.summary || "なし"}

【検索条件】
${userCondition}

【求人一覧】
${JSON.stringify(jobs, null, 2)}

【出力ルール】
- 6〜8文
- 箇条書き禁止
- 1文目で最有力を断定
- 2〜4文目で1位〜3位の理由
- 5文目で共通の懸念点
- 6文目で最初に応募すべき求人を断定
- 最後に1つだけ確認質問
- 求人名は会社名と職種名を自然に入れる
- 甘い評価は禁止
  `.trim();

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5",
    input: prompt,
  });

  return (
    response.output_text ||
    "現時点ではROSCAのリクルーティングアドバイザーが最有力です。次点でQuicker、3番手でグラファーです。まずはROSCAから受ける前提で進めたいですが、年収は600万円以上を絶対条件にしたいですか？"
  ).trim();
}

function buildJobsPreview(jobs) {
  return jobs
    .map((job, index) => {
      const salary =
        job.salary_min && job.salary_max
          ? `${job.salary_min}〜${job.salary_max}万円`
          : "要確認";
      return `${index + 1}. ${job.company}｜${job.title}｜${job.location || "勤務地要確認"}｜${salary}`;
    })
    .join("\n");
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
      if (event.type !== "message" || event.message.type !== "text") continue;

      const userId = event.source?.userId;
      const userText = event.message.text;
      const replyToken = event.replyToken;

      if (!userId || !replyToken) continue;

      const session = await getSession(userId);

      // 初回
      if (!session.history || session.history.length === 0) {
        const welcome = buildWelcomeMessage();
        session.history = [{ role: "assistant", content: welcome }];
        await saveSession(session);
        await replyMessage(replyToken, welcome);
        continue;
      }

      await showLoadingAnimation(userId, 5);

      // 実在求人検索モード
      if (isJobSearchMessage(userText)) {
        const condition = parseJobSearchCondition(userText);
        const jobs = await searchJobsInSupabase(condition);

        let result;
        if (!jobs.length) {
          result =
            "条件に合う求人がまだ見つかりませんでした。職種、勤務地、年収条件を少し広げると提案しやすいです。たとえば『RA 東京 500万以上』のように送ってもらえますか？";
        } else {
          const ranking = await recommendRealJobs(session, userText, jobs);
          const preview = buildJobsPreview(jobs);
          result = `${ranking}\n\n候補求人はこちらです。\n${preview}`;
        }

        session.history.push({ role: "user", content: userText });
        session.history.push({ role: "assistant", content: result });
        await saveSession(session);

        await replyMessage(replyToken, "確認中です");
        await pushMessage(userId, result);
        continue;
      }

      // 通常相談
      session.profile = updateProfileFromUserMessage(session.profile, userText);
      session.profile = await extractProfileWithAI(session.profile, userText);

      session.history.push({ role: "user", content: userText });

      const aiReply = await getCareerAdvice(session, userText);

      session.history.push({ role: "assistant", content: aiReply });

      await saveSession(session);

      await replyMessage(replyToken, "確認中です");
      await pushMessage(userId, aiReply);
    } catch (e) {
      console.error("Webhook error:", e?.response?.data || e.message || e);

      try {
        const userId = event.source?.userId;
        const replyToken = event.replyToken;

        if (replyToken) {
          await replyMessage(replyToken, "確認中です");
        }

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

// ===== 起動 =====
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port " + PORT);
});