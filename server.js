require("dotenv").config();
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 10000;

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

// ===== 初回メッセージ =====
function buildWelcomeMessage() {
  return `はじめまして！TAKARA AI Careerです。

このエージェントでは、あなたのキャリアに合わせて以下のサポートができます。

① 自己分析
② 向いている求人の方向性提案
③ 面接対策
④ 求人票の適合チェック

「転職相談したい」「面接対策したい」「この求人どう？」など、自由に話しかけてください。

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

// ===== ローディング =====
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

function defaultInterviewState() {
  return {
    active: false,
    target_role: null,
    question_count: 0,
    last_question: null,
    last_feedback: null,
  };
}

function defaultJobMode() {
  return {
    active: false,
    last_job_text: null,
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
    .select("user_id, history, profile, summary, updated_at, interview_state, job_mode")
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
      job_mode: defaultJobMode(),
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
    interview_state: data.interview_state || defaultInterviewState(),
    job_mode: data.job_mode || defaultJobMode(),
    updated_at: data.updated_at,
  };
}

async function saveSession(session) {
  const { error } = await supabase.from("line_ca_sessions").upsert({
    user_id: session.user_id,
    history: session.history,
    profile: session.profile,
    summary: session.summary || "",
    interview_state: session.interview_state || defaultInterviewState(),
    job_mode: session.job_mode || defaultJobMode(),
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

// ===== 要約 =====
async function summarizeHistory(summary, history) {
  const historyText = history
    .map((m) => `${m.role === "user" ? "ユーザー" : "CA"}: ${m.content}`)
    .join("\n");

  const prompt = `
あなたはキャリア面談の会話要約アシスタントです。
既存要約と今回会話を統合し、次回の面談で使える短い要約を作ってください。

要件:
- 300〜500文字
- 事実ベース
- 推測は書かない
- 以下を優先して残す
  1. 現職/業界/営業スタイル
  2. 実績/KPI
  3. 転職理由
  4. 希望条件
  5. 懸念点
  6. まだ未確認の論点
- 箇条書き禁止
- 日本語

【既存要約】
${summary || "なし"}

【今回会話】
${historyText || "なし"}
  `.trim();

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5",
    input: prompt,
  });

  return (response.output_text || "").trim();
}

async function compactSessionIfNeeded(session) {
  if (session.history.length < 20) return session;

  const oldPart = session.history.slice(0, -10);
  const keepPart = session.history.slice(-10);

  session.summary = await summarizeHistory(session.summary, oldPart);
  session.history = keepPart;

  return session;
}

// ===== モード判定 =====
function isInterviewStartMessage(text) {
  return /面接対策|模擬面接|面接練習|面接を練習|面接したい/.test(text || "");
}

function isInterviewEndMessage(text) {
  return /面接対策終了|模擬面接終了|面接終了|通常モード|通常相談に戻る|終了/.test(text || "");
}

function shouldSwitchToNormalMode(text) {
  return /向いている求人|求人の方向性|キャリア相談|転職相談|通常相談|通常モード|相談したい|求人を教えて|キャリアの方向性|転職の方向性/.test(text || "");
}

function detectTargetRole(text) {
  if (!text) return null;

  if (/RA|リクルーティングアドバイザー/.test(text)) return "RA";
  if (/CA|キャリアアドバイザー/.test(text)) return "CA";
  if (/両面/.test(text)) return "両面型人材紹介";
  if (/SaaS営業|IT営業|法人営業/.test(text)) return "法人営業";
  if (/カスタマーサクセス|CS/.test(text)) return "カスタマーサクセス";
  if (/経営企画/.test(text)) return "経営企画";

  return null;
}

function isJobReviewStartMessage(text) {
  return /この求人どう|求人を見て|求人見て|求人比較|求人票を見て|この案件どう|このポジションどう/.test(text || "");
}

function isJobReviewEndMessage(text) {
  return /求人評価終了|求人モード終了|通常相談に戻る|通常モード|終了/.test(text || "");
}

function looksLikeJobPosting(text) {
  if (!text) return false;
  return /仕事内容|業務内容|必須条件|歓迎条件|年収|勤務地|雇用形態|募集背景|ポジション|職務内容|応募資格|ミッション|想定年収|休日|福利厚生/.test(text);
}

// ===== 通常相談 =====
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
    return "次はどんな職種を考えていますか？";
  }
  if (!profile.desired_salary && !profile.work_style) {
    return "年収や働き方で、譲れない条件はありますか？";
  }
  return null;
}

async function getCareerAdvice(session, userMessage) {
  const historyText = recentHistoryText(session.history, 8);

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

【最重要】
- summaryを最優先で踏まえる
- 直近会話も踏まえる
- 取得済み情報は繰り返し聞かない
- 情報が足りないなら無理に結論を断定しない
- ただし、方向性が見えるなら一言で示す
- 友好的だが軽すぎない
- 箇条書き禁止
- 毎回ゼロから始めない

【回答フォーマット】
以下の順で、自然な3〜4文で答えてください。
1. まず軽く受け止める
2. 一言で方向性を述べる
3. 具体的な職種 or 業界を1〜2個出す
4. 理由を一言で添える
5. 最後に自然な質問を1つだけ置く
※ 情報不足でまだ方向性を絞れない場合は、無理に具体職種を断定せず、次に聞くべき1質問を優先する

【これまでの要約】
${session.summary || "まだ要約なし"}

【把握済みプロフィール】
${profileText}

【直近の会話】
${historyText || "なし"}

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

// ===== 面接 =====
function buildInterviewStartMessage(targetRole) {
  const roleText = targetRole ? `${targetRole}向けの` : "";
  return `${roleText}面接モードに入ります。これからは1問ずつ質問して、あなたの回答を厳しめに添削します。まずは「自己紹介を1分でお願いします」と言われた想定で答えてみてください。`;
}

async function evaluateInterviewAnswer(session, userAnswer) {
  const profile = session.profile || defaultProfile();
  const state = session.interview_state || defaultInterviewState();

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

  const prompt = `
あなたは優秀で厳しめの面接官兼面接コーチです。
候補者の回答を評価し、次の質問まで進めてください。

【対象職種】
${state.target_role || "未指定"}

【候補者プロフィール】
${profileText}

【会話要約】
${session.summary || "なし"}

【直近の質問】
${state.last_question || "自己紹介を1分でお願いします"}

【候補者の回答】
${userAnswer}

【やってほしいこと】
- 回答を実務目線で厳しめに評価
- 良い点を1つ
- 改善点を2つ
- 改善後の回答例を2〜4文で出す
- 最後に次の面接質問を1つだけ出す
- 箇条書きは使わない
- 全体で4〜6文程度
  `.trim();

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5",
    input: prompt,
  });

  const output =
    response.output_text ||
    "全体の方向性は悪くないですが、具体性をもう一段上げたいです。次の質問に進みます。";

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

// ===== 求人評価 =====
function buildJobReviewStartMessage() {
  return "了解です。求人票をそのまま貼ってください。あなたのこれまでの会話を踏まえて、合う点・懸念点・受けるべきかまで返します。";
}

async function evaluateJobFit(session, jobText) {
  const profile = session.profile || defaultProfile();

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

  const prompt = `
あなたは世界一のリクルーティングアドバイザーです。
候補者プロフィールと求人票を比較し、この候補者が受けるべき求人かを実務目線で判断してください。

【候補者プロフィール】
${profileText}

【会話要約】
${session.summary || "なし"}

【求人票】
${jobText}

【評価観点】
1. Must適合
2. Want適合
3. 再現性
4. 職種・営業タイプ適合
5. 条件適合
6. 懸念点

【出力ルール】
- 5〜6文
- 箇条書き禁止
- 1文目で結論（受けるべき / 条件付きであり / 優先度低め）
- 2〜3文目で合う点
- 4文目で懸念点
- 5文目で推奨度（高 / 中 / 低）を自然文で入れる
- 6文目で次に確認すべきことを1つだけ質問
- 甘い評価は禁止
- 不明点は不明と明記
  `.trim();

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5",
    input: prompt,
  });

  return (
    response.output_text ||
    "現時点では条件付きでありです。職種との接続は見えますが、再現性と期待役割にまだ確認したい点があります。直近の成果がこの求人の求める水準に届くかを見たいので、今の営業スタイルをもう少し詳しく教えてください。"
  ).trim();
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

      // ===== 初回メッセージ =====
      if (!session.history || session.history.length === 0) {
        const welcome = buildWelcomeMessage();
        session.history = [{ role: "assistant", content: welcome }];
        await saveSession(session);
        await replyMessage(replyToken, welcome);
        continue;
      }

      await showLoadingAnimation(userId, 5);

      // ===== 面接モード中に通常相談っぽい発言が来たら自動解除 =====
      if (session.interview_state?.active && shouldSwitchToNormalMode(userText)) {
        session.interview_state = defaultInterviewState();
      }

      // ===== 求人モード中に相談系が来たら自動解除 =====
      if (session.job_mode?.active && shouldSwitchToNormalMode(userText) && !looksLikeJobPosting(userText)) {
        session.job_mode = defaultJobMode();
      }

      // ===== 面接モード終了 =====
      if (isInterviewEndMessage(userText)) {
        session.interview_state = defaultInterviewState();
        session.history.push({ role: "user", content: userText });

        const endReply =
          "了解です。面接モードを終了して、通常のキャリア相談モードに戻します。気になる求人やキャリアの方向性があれば、そのまま続けて相談してください。";

        session.history.push({ role: "assistant", content: endReply });
        await compactSessionIfNeeded(session);
        await saveSession(session);

        await replyMessage(replyToken, "確認中です");
        await pushMessage(userId, endReply);
        continue;
      }

      // ===== 求人モード終了 =====
      if (isJobReviewEndMessage(userText) && session.job_mode?.active) {
        session.job_mode = defaultJobMode();
        session.history.push({ role: "user", content: userText });

        const endReply =
          "了解です。求人評価モードを終了して、通常のキャリア相談モードに戻します。別の求人を見たい時は『この求人どう？』と送ってください。";

        session.history.push({ role: "assistant", content: endReply });
        await compactSessionIfNeeded(session);
        await saveSession(session);

        await replyMessage(replyToken, "確認中です");
        await pushMessage(userId, endReply);
        continue;
      }

      // ===== 面接モード開始 =====
      if (isInterviewStartMessage(userText)) {
        const targetRole = detectTargetRole(userText);

        session.interview_state = {
          active: true,
          target_role: targetRole,
          question_count: 1,
          last_question: "自己紹介を1分でお願いします。",
          last_feedback: null,
        };

        session.job_mode = defaultJobMode();

        session.profile = updateProfileFromUserMessage(session.profile, userText);
        session.profile = await extractProfileWithAI(session.profile, userText);

        session.history.push({ role: "user", content: userText });

        const startReply = buildInterviewStartMessage(targetRole);
        session.history.push({ role: "assistant", content: startReply });

        await compactSessionIfNeeded(session);
        await saveSession(session);

        await replyMessage(replyToken, "確認中です");
        await pushMessage(userId, startReply);
        continue;
      }

      // ===== 求人モード開始 =====
      if (isJobReviewStartMessage(userText)) {
        session.job_mode = {
          active: true,
          last_job_text: null,
        };

        session.interview_state = defaultInterviewState();

        session.history.push({ role: "user", content: userText });

        const startReply = buildJobReviewStartMessage();
        session.history.push({ role: "assistant", content: startReply });

        await compactSessionIfNeeded(session);
        await saveSession(session);

        await replyMessage(replyToken, "確認中です");
        await pushMessage(userId, startReply);
        continue;
      }

      // ===== 求人モード中 =====
      if (session.job_mode?.active) {
        session.profile = updateProfileFromUserMessage(session.profile, userText);

        session.history.push({ role: "user", content: userText });

        if (!looksLikeJobPosting(userText)) {
          const askReply =
            "求人票っぽい内容をそのまま貼ってもらえると、かなり精度高く見れます。仕事内容、必須条件、歓迎条件、年収あたりが入っていると判断しやすいです。";

          session.history.push({ role: "assistant", content: askReply });
          await compactSessionIfNeeded(session);
          await saveSession(session);

          await replyMessage(replyToken, "確認中です");
          await pushMessage(userId, askReply);
          continue;
        }

        session.job_mode.last_job_text = userText;

        const result = await evaluateJobFit(session, userText);
        session.history.push({ role: "assistant", content: result });

        await compactSessionIfNeeded(session);
        await saveSession(session);

        await replyMessage(replyToken, "確認中です");
        await pushMessage(userId, result);
        continue;
      }

      // ===== 面接モード中 =====
      if (session.interview_state?.active) {
        session.profile = updateProfileFromUserMessage(session.profile, userText);

        session.history.push({ role: "user", content: userText });

        const result = await evaluateInterviewAnswer(session, userText);

        session.interview_state.last_feedback = result.reply;
        session.interview_state.last_question = result.nextQuestion;
        session.interview_state.question_count =
          (session.interview_state.question_count || 1) + 1;

        session.history.push({ role: "assistant", content: result.reply });

        await compactSessionIfNeeded(session);
        await saveSession(session);

        await replyMessage(replyToken, "確認中です");
        await pushMessage(userId, result.reply);
        continue;
      }

      // ===== 通常相談 =====
      session.profile = updateProfileFromUserMessage(session.profile, userText);
      session.profile = await extractProfileWithAI(session.profile, userText);

      session.history.push({ role: "user", content: userText });

      const aiReply = await getCareerAdvice(session, userText);
      session.history.push({ role: "assistant", content: aiReply });

      await compactSessionIfNeeded(session);
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