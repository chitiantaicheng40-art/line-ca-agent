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
「この求人どう？」
「RA 東京 600万以上」

まずは今のお仕事を教えてください。`;
}

function isJobSearch(text) {
  return /RA|CA|求人|仕事|転職|年収|万|東京|大阪|福岡|人材|IT|SaaS/i.test(
    text || ""
  );
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
      profile: {},
      summary: "",
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

  return data;
}

async function saveSession(session) {
  const { error } = await supabase.from("line_ca_sessions").upsert({
    ...session,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
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

      // ===== Postback: 他も見る =====
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

      if (!session.history || session.history.length === 0) {
        const welcome = buildWelcomeMessage();
        session.history = [{ role: "assistant", content: welcome }];
        await saveSession(session);
        await replyMessage(replyToken, welcome);
        continue;
      }

      await showLoading(userId);

      // ===== 求人検索 =====
      if (isJobSearch(text)) {
        const condition = parseCondition(text);
        const jobs = await searchJobs(condition);

        if (!jobs.length) {
          await replyMessage(replyToken, "確認中です");
          await pushMessage(
            userId,
            "条件に合う求人がまだ見つかりませんでした。勤務地や年収条件を少し広げると提案しやすいです。"
          );
          continue;
        }

        const topJob = jobs[0];

        session.last_recommended_job = {
          id: topJob.id,
          company: topJob.company,
          title: topJob.title,
          apply_url: topJob.apply_url,
        };
        session.last_recommended_jobs = jobs;

        session.history = session.history || [];
        session.history.push({ role: "user", content: text });
        session.history.push({
          role: "assistant",
          content: `最有力: ${topJob.company}｜${topJob.title}`,
        });

        await saveSession(session);

        await replyMessage(replyToken, "確認中です");
        await pushMessage(userId, [
          { type: "text", text: buildPreviewText(topJob) },
          buildJobButtons(topJob),
        ]);
        continue;
      }

      // ===== 応募意図 =====
      if (/応募したい|応募する|URL送って|応募URL/i.test(text)) {
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

      // ===== 通常 =====
      await replyMessage(replyToken, "相談内容をもう少し詳しく教えてください");
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