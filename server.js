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

app.get("/", (req, res) => res.send("OK"));

// ===== LINE =====
function validateLineSignature(body, signature) {
  const hash = crypto
    .createHmac("SHA256", process.env.LINE_CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

async function replyMessage(replyToken, messages) {
  const payload = Array.isArray(messages)
    ? messages
    : [{ type: "text", text: messages }];

  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken,
      messages: payload,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

async function pushMessage(userId, messages) {
  const payload = Array.isArray(messages)
    ? messages
    : [{ type: "text", text: messages }];

  await axios.post(
    "https://api.line.me/v2/bot/message/push",
    {
      to: userId,
      messages: payload,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

async function showLoading(userId) {
  try {
    await axios.post(
      "https://api.line.me/v2/bot/chat/loading/start",
      {
        chatId: userId,
        loadingSeconds: 5,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (_) {}
}

// ===== Defaults =====
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

function defaultInterviewState() {
  return {
    active: false,
    target_role: null,
    question_count: 0,
    last_question: null,
    last_feedback: null,
  };
}

// ===== Helpers =====
function buildWelcomeMessage() {
  return `はじめまして！TAKARA AI Careerです。

できること👇
① 自己分析
② 求人方向性提案
③ 面接対策
④ 実在求人の提案

例👇
「転職相談したい」
「面接対策したい」
「RA 東京 600万以上」

まずは今のお仕事を教えてください。`;
}

function safeJsonParse(text, fallback = {}) {
  try {
    return JSON.parse(text);
  } catch (_) {
    const match = String(text || "").match(/\{[\s\S]*\}/);
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
  return (history || [])
    .slice(-maxItems)
    .map((m) => `${m.role === "user" ? "ユーザー" : "CA"}: ${m.content}`)
    .join("\n");
}

function isJobSearch(text) {
  return /RA|CA|求人|仕事|転職|年収|万|東京|大阪|福岡|人材|IT|SaaS/i.test(
    text || ""
  );
}

function isApply(text) {
  return /応募したい|応募する|URL送って|応募URL/i.test(text || "");
}

function isInterviewStart(text) {
  return /面接対策|模擬面接|面接練習|面接したい/.test(text || "");
}

function isInterviewEnd(text) {
  return /面接対策終了|面接終了|通常モード|通常相談に戻る/.test(text || "");
}

function detectTargetRole(text) {
  if (/RA|リクルーティングアドバイザー/.test(text || "")) return "RA";
  if (/CA|キャリアアドバイザー/.test(text || "")) return "CA";
  if (/両面/.test(text || "")) return "RA/CA";
  if (/人事/.test(text || "")) return "採用人事";
  if (/営業/.test(text || "")) return "営業";
  return null;
}

function canUseInterview(session) {
  if ((session.plan_type || "free") === "standard") return true;
  return Number(session.interview_count || 0) < 1;
}

function buildUpgradeMessage() {
  return `この機能は有料プラン向けです。

無料プランでは
・求人提案
・初回相談
・面接体験1回まで

有料プランでは
・面接対策し放題
・回答添削
・継続相談
が使えます。`;
}

function parseCondition(text) {
  const salaryMatch = (text || "").match(/(\d{3,4})\s*万/);
  const minSalary = salaryMatch ? Number(salaryMatch[1]) : null;

  let location = null;
  if (/東京/.test(text || "")) location = "東京";
  else if (/大阪/.test(text || "")) location = "大阪";
  else if (/福岡/.test(text || "")) location = "福岡";

  return { minSalary, location, raw: text || "" };
}

function buildPreviewText(job) {
  const salary =
    job.salary_min && job.salary_max
      ? `${job.salary_min}〜${job.salary_max}万`
      : "要確認";

  return `最有力はこちらです👇
${job.company}｜${job.title}
勤務地: ${job.location || "要確認"}
年収: ${salary}`;
}

function buildJobButtons(job) {
  const salary =
    job.salary_min && job.salary_max
      ? `${job.salary_min}〜${job.salary_max}万`
      : "要確認";

  const title = (job.company || "求人詳細").slice(0, 40);
  const text = `${job.title || "職種未設定"}｜${salary}`.slice(0, 60);

  return {
    type: "template",
    altText: `${job.company} ${job.title} の応募メニュー`,
    template: {
      type: "buttons",
      title,
      text,
      actions: [
        {
          type: "uri",
          label: "詳細を見る",
          uri: job.apply_url || "https://example.com",
        },
        {
          type: "uri",
          label: "応募する",
          uri: job.apply_url || "https://example.com",
        },
        {
          type: "postback",
          label: "他も見る",
          data: "action=show_more_jobs",
          displayText: "他の求人も見たい",
        },
      ],
    },
  };
}

function buildMoreJobsText(jobs) {
  if (!jobs || jobs.length <= 1) {
    return "比較できる他の求人は今はありません。";
  }

  return jobs
    .slice(1)
    .map((j, i) => {
      const salary =
        j.salary_min && j.salary_max
          ? `${j.salary_min}〜${j.salary_max}万`
          : "要確認";

      return `${i + 2}. ${j.company}｜${j.title}
勤務地: ${j.location || "要確認"}
年収: ${salary}
${j.apply_url || "URL未設定"}`;
    })
    .join("\n\n");
}

// ===== Session =====
async function getSession(userId) {
  const { data, error } = await supabase
    .from("line_ca_sessions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    const init = {
      user_id: userId,
      history: [],
      profile: defaultProfile(),
      summary: "",
      interview_state: defaultInterviewState(),
      plan_type: "free",
      usage_count: 0,
      interview_count: 0,
      last_recommended_job: null,
      last_recommended_jobs: null,
      updated_at: new Date().toISOString(),
    };

    const { error: insertError } = await supabase
      .from("line_ca_sessions")
      .insert(init);

    if (insertError) throw insertError;
    return init;
  }

  return {
    ...data,
    history: Array.isArray(data.history) ? data.history : [],
    profile: data.profile || defaultProfile(),
    interview_state: data.interview_state || defaultInterviewState(),
    plan_type: data.plan_type || "free",
    usage_count: data.usage_count || 0,
    interview_count: data.interview_count || 0,
  };
}

async function saveSession(session) {
  const { error } = await supabase.from("line_ca_sessions").upsert({
    ...session,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

// ===== Profile =====
function updateProfileFromUserMessage(profile, text) {
  const msg = (text || "").trim();
  const next = { ...(profile || defaultProfile()) };

  if (!next.current_job) {
    if (/法人営業|個人営業|営業|RA|CA|人事|マーケ|CS|エンジニア|事務/.test(msg)) {
      next.current_job = msg;
    }
  }

  if (!next.industry) {
    if (/IT|SaaS|人材|広告|製造|医療|不動産|金融|物流|メーカー|HR/.test(msg)) {
      next.industry = msg;
    }
  }

  if (!next.achievements) {
    if (/\d/.test(msg) && /件|円|万|%|社|名|達成|売上|粗利|受注|契約/.test(msg)) {
      next.achievements = msg;
    }
  }

  if (!next.reason_for_change) {
    if (/転職|辞めたい|やめたい|年収|残業|働き方|将来|キャリア|評価|不満|提案の幅/.test(msg)) {
      next.reason_for_change = msg;
    }
  }

  if (!next.desired_role) {
    if (/RA|CA|両面|人材営業|求人広告|営業|採用人事/.test(msg)) {
      next.desired_role = msg;
    }
  }

  if (!next.desired_salary) {
    if (/年収|万円|希望年収/.test(msg)) {
      next.desired_salary = msg;
    }
  }

  if (!next.work_style) {
    if (/リモート|在宅|土日|勤務地|働き方/.test(msg)) {
      next.work_style = msg;
    }
  }

  if (!next.concerns) {
    if (/不安|心配|懸念|自信がない|迷って/.test(msg)) {
      next.concerns = msg;
    }
  }

  return next;
}

async function extractProfileWithAI(currentProfile, userMessage) {
  const prompt = `
あなたはキャリア面談の情報抽出アシスタントです。
以下のユーザー発言からプロフィール項目をJSONで抽出してください。
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

  const res = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5",
    input: prompt,
  });

  const parsed = safeJsonParse(res.output_text || "{}", {});
  return mergeProfile(currentProfile || defaultProfile(), parsed);
}

// ===== Jobs =====
async function searchJobs(condition) {
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("is_active", true);

  if (error) throw error;

  let jobs = data || [];

  if (condition.minSalary) {
    jobs = jobs.filter((j) => {
      return (
        Number(j.salary_min || 0) >= condition.minSalary ||
        Number(j.salary_max || 0) >= condition.minSalary
      );
    });
  }

  if (condition.location) {
    jobs = jobs.filter((j) =>
      String(j.location || "").includes(condition.location)
    );
  }

  jobs = jobs.filter((job) => {
    const text = [
      job.title,
      job.company,
      job.job_type,
      job.industry,
      job.description,
      job.requirements,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return (
      text.includes("ra") ||
      text.includes("リクルーティング") ||
      text.includes("人材")
    );
  });

  jobs.sort((a, b) => Number(b.salary_max || 0) - Number(a.salary_max || 0));
  return jobs.slice(0, 3);
}

async function buildJobReasoning(session, jobs, conditionText) {
  const profile = session.profile || defaultProfile();

  const prompt = `
あなたは優秀なリクルーティングアドバイザーです。
候補者プロフィールと求人候補を比較し、最有力求人の理由を短く説明してください。

【候補者プロフィール】
${JSON.stringify(profile, null, 2)}

【検索条件】
${conditionText}

【求人候補】
${JSON.stringify(jobs, null, 2)}

【出力ルール】
- 4〜5文
- 箇条書き禁止
- 1文目で最有力を断定
- 2〜3文目で理由
- 4文目で懸念点や次点との違い
- 最後に1つだけ確認質問
  `.trim();

  const res = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5",
    input: prompt,
  });

  return res.output_text || `最有力は${jobs[0]?.company}｜${jobs[0]?.title}です。今の経験との再現性が高いです。`;
}

// ===== Interview =====
async function evaluateInterviewAnswer(session, userAnswer) {
  const profile = session.profile || defaultProfile();
  const state = session.interview_state || defaultInterviewState();

  const prompt = `
あなたは厳しめの面接官兼面接コーチです。
候補者の回答を評価し、改善例と次の質問を返してください。

【対象職種】
${state.target_role || "未指定"}

【候補者プロフィール】
${JSON.stringify(profile, null, 2)}

【直前の質問】
${state.last_question || "自己紹介を1分でお願いします"}

【候補者の回答】
${userAnswer}

【出力ルール】
- 4〜6文
- 1文目で総評
- 2文目で良い点
- 3〜4文目で改善点
- 5文目で改善例
- 最後に次の質問
- 箇条書き禁止
  `.trim();

  const res = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5",
    input: prompt,
  });

  const output =
    res.output_text ||
    "方向性は悪くないですが、具体性をもう一段上げたいです。次は転職理由を教えてください。";

  const sentences = output
    .replace(/\n/g, " ")
    .split(/(?<=[。！？])/)
    .map((s) => s.trim())
    .filter(Boolean);

  const nextQuestion =
    sentences[sentences.length - 1] || "次に、転職理由を教えてください。";

  return {
    reply: output.trim(),
    nextQuestion,
  };
}

// ===== General Advice =====
async function getGeneralAdvice(session, text) {
  const historyText = recentHistoryText(session.history, 8);

  const prompt = `
あなたは優秀なキャリアアドバイザーです。
短く、でも実務的に返してください。

【プロフィール】
${JSON.stringify(session.profile || defaultProfile(), null, 2)}

【直近会話】
${historyText}

【今回の発言】
${text}

【ルール】
- 3〜4文
- 箇条書き禁止
- 最後は質問で終える
  `.trim();

  const res = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5",
    input: prompt,
  });

  return res.output_text || "もう少し詳しく教えてください。";
}

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  const signature = req.headers["x-line-signature"];
  if (!validateLineSignature(req.rawBody, signature)) {
    return res.status(401).send("Invalid");
  }

  res.sendStatus(200);

  const events = req.body.events || [];

  for (const event of events) {
    try {
      const userId = event.source?.userId;
      if (!userId) continue;

      const session = await getSession(userId);

      // ===== Postback =====
      if (event.type === "postback") {
        const data = event.postback?.data || "";

        if (data === "action=show_more_jobs") {
          const jobs = session.last_recommended_jobs || [];
          const text = buildMoreJobsText(jobs);
          await pushMessage(userId, text);
          continue;
        }

        continue;
      }

      if (event.type !== "message" || event.message.type !== "text") continue;

      const replyToken = event.replyToken;
      const text = event.message.text || "";

      if (!replyToken) continue;

      // 初回
      if (!session.history || session.history.length === 0) {
        const welcome = buildWelcomeMessage();
        session.history = [{ role: "assistant", content: welcome }];
        await saveSession(session);
        await replyMessage(replyToken, welcome);
        continue;
      }

      await showLoading(userId);

      // 面接終了
      if (isInterviewEnd(text)) {
        session.interview_state = defaultInterviewState();
        session.history.push({ role: "user", content: text });

        const msg = "了解です。面接モードを終了して通常相談に戻します。";
        session.history.push({ role: "assistant", content: msg });
        await saveSession(session);

        await replyMessage(replyToken, "確認中です");
        await pushMessage(userId, msg);
        continue;
      }

      // 面接開始
      if (isInterviewStart(text)) {
        if (!canUseInterview(session)) {
          const msg = buildUpgradeMessage();
          session.history.push({ role: "user", content: text });
          session.history.push({ role: "assistant", content: msg });
          await saveSession(session);

          await replyMessage(replyToken, "確認中です");
          await pushMessage(userId, msg);
          continue;
        }

        session.interview_state = {
          active: true,
          target_role: detectTargetRole(text),
          question_count: 1,
          last_question: "自己紹介を1分でお願いします。",
          last_feedback: null,
        };

        session.interview_count = Number(session.interview_count || 0) + 1;
        session.history.push({ role: "user", content: text });

        const msg = `${session.interview_state.target_role || "面接"}向けの面接モードに入ります。まずは「自己紹介を1分でお願いします」と言われた想定で答えてみてください。`;
        session.history.push({ role: "assistant", content: msg });
        await saveSession(session);

        await replyMessage(replyToken, "確認中です");
        await pushMessage(userId, msg);
        continue;
      }

      // 面接モード中
      if (session.interview_state?.active) {
        session.profile = updateProfileFromUserMessage(session.profile, text);
        session.history.push({ role: "user", content: text });

        const result = await evaluateInterviewAnswer(session, text);

        session.interview_state.last_feedback = result.reply;
        session.interview_state.last_question = result.nextQuestion;
        session.interview_state.question_count =
          Number(session.interview_state.question_count || 0) + 1;

        session.history.push({ role: "assistant", content: result.reply });
        await saveSession(session);

        await replyMessage(replyToken, "確認中です");
        await pushMessage(userId, result.reply);
        continue;
      }

      // 応募意図
      if (isApply(text)) {
        const job = session.last_recommended_job;

        if (!job?.apply_url) {
          await replyMessage(replyToken, "確認中です");
          await pushMessage(
            userId,
            "直前のおすすめ求人がまだありません。まずは『RA 東京 500万以上』のように送ってください。"
          );
          continue;
        }

        await replyMessage(replyToken, "確認中です");
        await pushMessage(
          userId,
          `${job.company}｜${job.title}
${job.apply_url}`
        );
        continue;
      }

      // 求人検索
      if (isJobSearch(text)) {
        session.profile = updateProfileFromUserMessage(session.profile, text);

        const condition = parseCondition(text);
        const jobs = await searchJobs(condition);

        if (!jobs.length) {
          const msg =
            "条件に合う求人がまだ見つかりませんでした。勤務地や年収条件を少し広げると提案しやすいです。";
          session.history.push({ role: "user", content: text });
          session.history.push({ role: "assistant", content: msg });
          session.usage_count = Number(session.usage_count || 0) + 1;
          await saveSession(session);

          await replyMessage(replyToken, "確認中です");
          await pushMessage(userId, msg);
          continue;
        }

        const topJob = jobs[0];
        const reason = await buildJobReasoning(session, jobs, text);

        session.last_recommended_job = {
          id: topJob.id,
          company: topJob.company,
          title: topJob.title,
          apply_url: topJob.apply_url,
        };
        session.last_recommended_jobs = jobs;
        session.usage_count = Number(session.usage_count || 0) + 1;

        session.history.push({ role: "user", content: text });
        session.history.push({
          role: "assistant",
          content: `最有力: ${topJob.company}｜${topJob.title}`,
        });

        await saveSession(session);

        await replyMessage(replyToken, "確認中です");
        await pushMessage(userId, [
          { type: "text", text: reason },
          { type: "text", text: buildPreviewText(topJob) },
          buildJobButtons(topJob),
        ]);
        continue;
      }

      // 通常相談
      session.profile = updateProfileFromUserMessage(session.profile, text);
      session.profile = await extractProfileWithAI(session.profile, text);

      session.history.push({ role: "user", content: text });

      const reply = await getGeneralAdvice(session, text);

      session.history.push({ role: "assistant", content: reply });
      session.usage_count = Number(session.usage_count || 0) + 1;

      await saveSession(session);

      await replyMessage(replyToken, "確認中です");
      await pushMessage(userId, reply);
    } catch (e) {
      console.error("Webhook error:", e?.response?.data || e.message || e);

      try {
        if (event.replyToken) {
          await replyMessage(event.replyToken, "ごめん、今ちょっと不安定です。");
        }
      } catch (_) {}
    }
  }
});

app.listen(PORT, () => {
  console.log("Server running");
});