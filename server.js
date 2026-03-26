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

app.get("/", (req, res) => res.send("OK"));

// ===== LINE =====
function validateLineSignature(body, signature) {
  const hash = crypto
    .createHmac("SHA256", process.env.LINE_CHANNEL_SECRET)
    .update(body)
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
      },
    }
  );
}

async function showLoading(userId) {
  try {
    await axios.post(
      "https://api.line.me/v2/bot/chat/loading/start",
      { chatId: userId, loadingSeconds: 5 },
      {
        headers: {
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
      }
    );
  } catch (e) {}
}

// ===== 判定 =====
function isJobSearch(text) {
  return /RA|求人|仕事|転職|年収|万|東京|大阪|福岡/i.test(text);
}

function isApply(text) {
  return /応募|URL|応募したい/i.test(text);
}

// ===== 条件抽出 =====
function parseCondition(text) {
  const salaryMatch = text.match(/(\d{3,4})\s*万/);
  const minSalary = salaryMatch ? Number(salaryMatch[1]) : null;

  let location = null;
  if (/東京/.test(text)) location = "東京";
  if (/大阪/.test(text)) location = "大阪";

  return { minSalary, location, raw: text };
}

// ===== 求人検索 =====
async function searchJobs(condition) {
  let { data } = await supabase
    .from("jobs")
    .select("*")
    .eq("is_active", true);

  let jobs = data || [];

  // 年収フィルタ
  if (condition.minSalary) {
    jobs = jobs.filter((j) => {
      return (
        (j.salary_min || 0) >= condition.minSalary ||
        (j.salary_max || 0) >= condition.minSalary
      );
    });
  }

  // 勤務地フィルタ
  if (condition.location) {
    jobs = jobs.filter((j) =>
      (j.location || "").includes(condition.location)
    );
  }

  // ★重要：全文マッチ
  jobs = jobs.filter((job) => {
    const text = [
      job.title,
      job.company,
      job.job_type,
      job.industry,
      job.description,
    ]
      .join(" ")
      .toLowerCase();

    return (
      text.includes("ra") ||
      text.includes("リクルーティング") ||
      text.includes("人材")
    );
  });

  return jobs.slice(0, 3);
}

// ===== 表示 =====
function buildPreview(jobs) {
  return jobs
    .map((j, i) => {
      return `${i + 1}. ${j.company}｜${j.title}
年収: ${j.salary_min}〜${j.salary_max}万
URL: ${j.apply_url || "未設定"}`;
    })
    .join("\n\n");
}

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  const signature = req.headers["x-line-signature"];
  if (!validateLineSignature(req.rawBody, signature)) {
    return res.status(401).send("Invalid");
  }

  res.sendStatus(200);

  const event = req.body.events[0];
  if (!event) return;

  const userId = event.source.userId;
  const text = event.message.text;

  await showLoading(userId);

  // ===== 応募 =====
  if (isApply(text)) {
    const { data } = await supabase
      .from("line_ca_sessions")
      .select("last_recommended_job")
      .eq("user_id", userId)
      .single();

    const job = data?.last_recommended_job;

    if (job?.apply_url) {
      await replyMessage(event.replyToken, "確認中です");
      await pushMessage(
        userId,
        `${job.company}｜${job.title}
${job.apply_url}`
      );
    } else {
      await replyMessage(event.replyToken, "求人がまだありません");
    }
    return;
  }

  // ===== 求人検索 =====
  if (isJobSearch(text)) {
    const condition = parseCondition(text);
    const jobs = await searchJobs(condition);

    if (!jobs.length) {
      await replyMessage(event.replyToken, "確認中です");
      await pushMessage(userId, "求人が見つかりませんでした");
      return;
    }

    const topJob = jobs[0];

    await supabase.from("line_ca_sessions").upsert({
      user_id: userId,
      last_recommended_job: topJob,
    });

    const preview = buildPreview(jobs);

    await replyMessage(event.replyToken, "確認中です");
    await pushMessage(
      userId,
      `${preview}

気になる求人があれば「応募したい」と送ってください`
    );

    return;
  }

  // ===== その他 =====
  await replyMessage(event.replyToken, "相談内容をもう少し詳しく教えてください");
});

// ===== 起動 =====
app.listen(PORT, () => {
  console.log("Server running");
});