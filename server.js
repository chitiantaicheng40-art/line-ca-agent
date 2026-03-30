require("dotenv").config();
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 10000;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// ===== Mock Interview =====
const MOCK_INTERVIEW_QUESTIONS_BY_TYPE = {
  common: [
    "これまでのご経歴を1〜2分程度で簡単にお願いします。",
    "なぜ転職を考えているのですか？",
    "これまでの仕事で成果を出した経験を教えてください。",
    "あなたの強みやスキルについて教えてください。それをどのように仕事に活かしてきたか、具体的な例を交えてお話しください。",
    "逆に、仕事で苦労したことや失敗したこと、それをどう乗り越えたか教えてください。",
    "なぜこの職種・業界を志望しているのですか？",
    "最後に、何か質問はありますか？",
  ],

  sales: [
    "これまでの営業経験を簡単に教えてください。",
    "最も成果を出した営業経験について、工夫したことも含めて教えてください。",
    "数字が厳しい状況のとき、どのように立て直しますか？",
    "顧客から厳しい要望やクレームを受けたとき、どのように対応しますか？",
    "あなたが営業として他の人より強いと思う点は何ですか？",
    "なぜ営業職を続けたいと考えているのですか？",
  ],

  revops: [
    "なぜ営業から営業企画・RevOpsに挑戦したいのですか？",
    "売上125%を達成した要因を、再現性のあるプロセスとして説明してください。",
    "営業プロセスのどこにボトルネックがあるか、どのように特定しますか？",
    "SFAやKPIをどのように使って営業組織を改善しますか？",
  ],

  cs: [
    "これまで顧客の課題解決をした経験について教えてください。",
    "顧客の利用が進まない場合、どのように改善しますか？",
    "解約リスクの高い顧客に対して、どのようにアプローチしますか？",
    "顧客と社内の板挟みになったとき、どのように調整しますか？",
    "カスタマーサクセスとして最も重要だと思うことは何ですか？",
  ],

  planning: [
    "なぜ営業企画・事業企画に挑戦したいのですか？",
    "これまでに業務改善や仕組み化を行った経験を教えてください。",
    "現場の課題をどのように整理し、施策に落とし込んできましたか？",
    "数字やデータを使って改善した経験があれば教えてください。",
    "営業企画として、入社後どのようなことに取り組みたいですか？",
  ],

  ra: [
    "採用要件を定義するときに、最も重要だと考えていることは何ですか？",
    "採用意欲が低い企業に対して、どのように提案しますか？",
    "年収レンジが低い企業に対して、どのように候補者集客の難しさを伝えますか？",
    "企業と候補者の希望が合わないとき、どのように調整しますか？",
    "あなたが考える、優秀なRAとはどのような人ですか？",
  ],
};

const MOCK_INTERVIEW_COMPANY_TEMPLATES = {
  recruit_ra: {
    label: "リクルート RA",
    questions: [
      "採用要件を定義するときに、最も重要だと考えていることは何ですか？",
      "採用意欲が低い企業に対して、どのように提案しますか？",
      "年収レンジが低い企業に対して、どのように候補者集客の難しさを伝えますか？",
      "企業と候補者の希望が合わないとき、どのように調整しますか？",
      "あなたが考える、優秀なRAとはどのような人ですか？",
    ],
  },

  saas_planning: {
    label: "SaaS 営業企画",
    questions: [
      "なぜSaaS企業の営業企画に挑戦したいのですか？",
      "営業プロセスのどこに課題があるか、どのように特定しますか？",
      "KPI設計をするとしたら、どの数字を重要視しますか？",
      "現場の営業が新しい運用に反発した場合、どのように進めますか？",
      "営業企画として、入社後3か月で何を優先して取り組みますか？",
    ],
  },

  saas_sales: {
    label: "SaaS 営業",
    questions: [
      "SaaS営業として成果を出すために、最も重要だと思うことは何ですか？",
      "初回商談で顧客の課題をどう引き出しますか？",
      "受注確度の低い案件をどのように見極めますか？",
      "競合比較で不利な状況のとき、どのように提案しますか？",
      "継続的に成果を出すために、自分でどのような改善を回しますか？",
    ],
  },

manufacturing_dx_bizops: {
  label: "製造DX BizOps / CS Ops",
  questions: [
    "これまでのご経歴を1〜2分で教えてください。",
    "なぜ営業からBizOps / CS Opsに挑戦したいのですか？",
    "既存顧客で売上125%を達成した時、どのように課題整理・打ち手設計・巻き込みを行いましたか？",
    "製造現場でオンボーディングが進まない時、どこに原因があると考え、どう改善しますか？",
    "現場・情シス・決裁者の意見が割れた場合、どのように合意形成しますか？",
    "更新率やNRRを上げるために、どのKPIを見て、どの順で改善しますか？",
    "導入初期の顧客で活用が進んでいない場合、最初の30日で何をしますか？"
  ],
},

hrtech_revops: {
  label: "HRTech RevOps",
  questions: [
    "なぜ営業からRevOpsに挑戦したいのですか？",
    "RA経験を、営業企画やRevOpsでどのように活かせると思いますか？",
    "更新率やNRRを改善するために、どのKPIを重視しますか？",
    "営業・CS・マーケの連携が悪い時、どこから改善しますか？",
    "営業現場が新しい運用に反発した場合、どのように定着させますか？",
    "まず入社後90日で何を可視化・改善したいですか？"
  ],
},

  human_sales: {
    label: "人材営業",
    questions: [
      "人材営業として企業の採用課題をどう捉えますか？",
      "求人要件が曖昧な企業に対して、どのように整理を進めますか？",
      "採用が難航している企業に対して、どのような打ち手を提案しますか？",
      "他社エージェントとの差別化をどのように伝えますか？",
      "人材営業として成果を出す人の共通点は何だと思いますか？",
    ],
  },
};

// ===== OpenAI =====
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ===== Supabase =====
const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
    : null;

// ===== ENV =====
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

// ===== Middleware =====
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ===== Health Check =====
app.get("/", (req, res) => {
  res.status(200).send("OK");
});

// ===== LINE Signature Check =====
function validateLineSignature(body, signature) {
  const hash = crypto
    .createHmac("SHA256", LINE_CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

// ===== LINE Reply =====
async function replyToLine(replyToken, text) {
  try {
    await axios.post(
      "https://api.line.me/v2/bot/message/reply",
      {
        replyToken,
        messages: [
          {
            type: "text",
            text: String(text || "").slice(0, 5000),
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        },
      }
    );
  } catch (error) {
    console.error("LINE reply error:", error.response?.data || error.message);
  }
}

// ===== LINE Loading =====
async function showLineLoading(userId, seconds = 10) {
  try {
    const allowed = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
    const loadingSeconds = allowed.includes(seconds) ? seconds : 10;

    await axios.post(
      "https://api.line.me/v2/bot/chat/loading/start",
      {
        chatId: userId,
        loadingSeconds,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        },
      }
    );
  } catch (error) {
    console.error("LINE loading error:", error.response?.data || error.message);
  }
}

// ===== Menu Text =====
function getMainMenuText() {
  return `途中で話題を変えても大丈夫です。

【できること】
1. 自己分析
2. 求人提案
3. 職務経歴書・経験整理
4. 面接対策
5. キャリア相談
6. 模擬面接
7. 企業テンプレ管理

【入力例】
・自己分析
・求人提案
・職務経歴書を作りたい
・面接対策
・模擬面接 営業企画 厳しめ
・模擬面接 リクルートRA 厳しめ
・この回答を添削して
・厳しめで添削
・通過率が上がる言い方にして
・企業テンプレ一覧

【操作】
・再開
・一旦止める
・企業テンプレ追加
・企業テンプレ: リクルート

まずは「求人提案」「自己分析」「模擬面接 営業企画 厳しめ」など、やりたいことをそのまま送ってください。`;
}

function getNextActionMenuByTopic(topic = "") {
  switch (topic) {
    case "self_analysis":
      return `自己分析おつかれさまでした。

次はここから進められます👇
① 求人提案
② 職務経歴書・経験整理
③ 面接対策
④ キャリア相談
⑤ 模擬面接モード

やりたいものをそのまま送ってください。`;

    case "job_suggestion":
      return `求人提案の次は、こんな進め方ができます👇
① 気になる求人の深掘り
② 職務経歴書・経験整理
③ 職務経歴書完成版
④ 面接対策
⑤ キャリア相談
⑥ 模擬面接モード

やりたいものをそのまま送ってください。`;

    case "resume":
      return `職務経歴書・経験整理の次は、こちらもできます👇
① 職務経歴書完成版
② 求人提案
③ 面接対策
④ キャリア相談
⑤ 模擬面接モード

やりたいものをそのまま送ってください。`;

    case "resume_complete":
      return `職務経歴書完成版の次は、こちらもできます👇
① 面接対策
② 求人提案
③ キャリア相談
④ 模擬面接モード

やりたいものをそのまま送ってください。`;

    case "interview":
      return `面接対策の次は、こちらも進められます👇
① 求人提案
② 職務経歴書・経験整理
③ 職務経歴書完成版
④ キャリア相談
⑤ 模擬面接モード
⑥ 回答添削

やりたいものをそのまま送ってください。`;

    case "mock_interview":
      return `模擬面接おつかれさまでした。

次は、こちらも進められます👇
① 面接対策
② 職務経歴書・経験整理
③ 職務経歴書完成版
④ 求人提案
⑤ キャリア相談
⑥ 前回の模擬面接
⑦ 前回の改善点
⑧ 前回との比較
⑨ 回答添削

やりたいものをそのまま送ってください。`;

    case "career":
      return `キャリア相談の次は、こちらもできます👇
① 自己分析
② 求人提案
③ 職務経歴書・経験整理
④ 職務経歴書完成版
⑤ 面接対策
⑥ 模擬面接モード
⑦ 回答添削

やりたいものをそのまま送ってください。`;

    default:
      return getMainMenuText();
  }
}

// ===== Intent Detection =====
function detectMenuIntent(text = "") {
  const t = (text || "").trim();

  if (!t) return null;

  if (
    t.includes("できること") ||
    t.includes("何ができる") ||
    t.includes("なにができる") ||
    t === "メニュー" ||
    t === "一覧" ||
    t.includes("話を変えたい") ||
    t.includes("テーマ変えたい") ||
    t.includes("他に何できる")
  ) {
    return "show_menu";
  }

  if (t === "1" || t === "自己分析" || t === "自己分析したい") {
    return "self_analysis";
  }

  if (
    t === "2" ||
    t === "求人提案" ||
    t === "求人提案して" ||
    t === "求人紹介" ||
    t === "求人を提案して"
  ) {
    return "job_suggestion";
  }

  if (
    t === "3" ||
    t === "職務経歴書" ||
    t === "職務経歴書完成版" ||
    t === "完成版" ||
    t === "経験整理" ||
    t === "経歴整理"
  ) {
    return t.includes("完成版") ? "resume_complete" : "resume";
  }

  if (t === "4" || t === "面接対策") return "interview";
  if (t === "5" || t === "キャリア相談") return "career";
  if (t === "6" || t.includes("模擬面接")) return "mock_interview";

  return null;
}

function detectMockInterviewCommand(text = "") {
  const t = (text || "").trim().toLowerCase();
  return (
    t.includes("模擬面接") ||
    t.includes("mock interview") ||
    t.includes("mock_interview")
  );
}

function detectMockInterviewReviewCommand(text = "") {
  const t = (text || "").trim();
  return (
    t.includes("前回の模擬面接") ||
    t.includes("前回の改善点") ||
    t.includes("前回との比較")
  );
}

function detectAnswerPolishCommand(text = "") {
  const t = (text || "").trim();

  return (
    t.includes("この回答を添削") ||
    t.includes("添削して") ||
    t.includes("厳しめで添削") ||
    t.includes("通過率が上がる言い方") ||
    t.includes("面接向けに直して") ||
    t.includes("面接用に直して")
  );
}

function shouldUseStarterReply(userMessage = "", menuIntent = null) {
  const t = (userMessage || "").trim();
  if (!menuIntent) return false;

  const detailHints = [
    "年収",
    "勤務地",
    "勤務",
    "出社",
    "リモート",
    "フルリモート",
    "業界",
    "職種",
    "営業経験",
    "企画",
    "転職",
    "現職",
    "避けたい",
    "したい",
    "希望",
    "以上",
    "以下",
    "くらい",
    "未満",
    "saaS",
    "SaaS",
    "人材",
    "メーカー",
    "企業",
    "志望動機",
  ];

  if (menuIntent === "mock_interview") return false;
  if (t.length >= 20) return false;
  if (detailHints.some((w) => t.includes(w))) return false;

  return true;
}

function detectFinishedTopic(text = "") {
  const t = (text || "").trim();

  if (!t) return null;
  if (t.includes("自己分析")) return "self_analysis";
  if (t.includes("求人提案") || t.includes("求人紹介")) return "job_suggestion";
  if (t.includes("職務経歴書完成版") || t === "完成版") return "resume_complete";
  if (
    t.includes("職務経歴書") ||
    t.includes("経験整理") ||
    t.includes("経歴整理")
  ) {
    return "resume";
  }
  if (t.includes("模擬面接")) return "mock_interview";
  if (t.includes("面接対策")) return "interview";
  if (t.includes("キャリア相談")) return "career";

  return null;
}

function shouldAppendMenu(userText = "", aiText = "") {
  const t = (userText || "").trim();
  if (!t) return false;

  const intent = detectMenuIntent(t);
  if (intent) return false;

  const shortTriggers = [
    "ありがとう",
    "ありがと",
    "OK",
    "ok",
    "了解",
    "助かった",
    "いいね",
    "次",
    "ほか",
    "他",
  ];

  if (shortTriggers.some((w) => t.includes(w))) return true;
  if ((aiText || "").length > 350) return true;

  return false;
}

// ===== Topic State =====
function isShortContinuationMessage(text = "") {
  const t = (text || "").trim();
  if (!t) return false;

  const continuationPhrases = [
    "お願いします",
    "お願い",
    "次",
    "次いこう",
    "次行こう",
    "次いきましょう",
    "次行きましょう",
    "続けて",
    "続き",
    "それで",
    "それやろう",
    "それやりましょう",
    "やる",
    "進める",
    "進めましょう",
    "もっと",
    "詳しく",
    "具体的に",
    "お願いします！",
    "お願いいたします",
  ];

  if (continuationPhrases.includes(t)) return true;
  if (t.length <= 12 && continuationPhrases.some((p) => t.includes(p))) return true;

  return false;
}

function resolveCurrentTopic(userMessage = "", sessionCurrentTopic = null) {
  const explicitIntent = detectMenuIntent(userMessage);

  if (
    explicitIntent &&
    [
      "self_analysis",
      "job_suggestion",
      "resume",
      "resume_complete",
      "interview",
      "career",
      "mock_interview",
    ].includes(explicitIntent)
  ) {
    return explicitIntent;
  }

  if (isShortContinuationMessage(userMessage) && sessionCurrentTopic) {
    return sessionCurrentTopic;
  }

  return sessionCurrentTopic || null;
}

// ===== Job Suggestion Helpers =====
function isJobSuggestionContext(text = "") {
  const t = (text || "").trim();
  if (!t) return false;

  return (
    t.includes("求人提案") ||
    t.includes("求人紹介") ||
    t.includes("合う求人") ||
    t.includes("おすすめ求人") ||
    t.includes("どんな求人") ||
    t.includes("求人を見たい") ||
    t.includes("仕事を探したい")
  );
}

function isFollowupRequest(text = "") {
  const s = String(text || "").trim();

  return [
    "お願いします",
    "お願い",
    "次",
    "次へ",
    "続けて",
    "続き",
    "もっと詳しく",
    "詳しく",
    "具体的に",
    "深掘り",
    "もっと",
    "おすすめ順に詳しく",
  ].includes(s);
}

function isNextRequest(text = "") {
  const s = String(text || "").trim();

  return (
    s === "次" ||
    s === "次へ" ||
    s === "続いて" ||
    s === "続き" ||
    s === "別案" ||
    s === "ほか"
  );
}

function detectRequestedSuggestionLabel(text = "") {
  const s = String(text || "").trim().toUpperCase();

  if (
    s === "A" ||
    s.includes(" A ") ||
    s.startsWith("A ") ||
    s.endsWith(" A") ||
    s.includes("Aが気になる") ||
    s.includes("Aを詳しく") ||
    s.includes("Aを深掘り") ||
    s.includes("A案") ||
    s.includes("模擬面接 A")
  ) {
    return "A";
  }

  if (
    s === "B" ||
    s.includes(" B ") ||
    s.startsWith("B ") ||
    s.endsWith(" B") ||
    s.includes("Bが気になる") ||
    s.includes("Bを詳しく") ||
    s.includes("Bを深掘り") ||
    s.includes("B案") ||
    s.includes("模擬面接 B")
  ) {
    return "B";
  }

  if (
    s === "C" ||
    s.includes(" C ") ||
    s.startsWith("C ") ||
    s.endsWith(" C") ||
    s.includes("Cが気になる") ||
    s.includes("Cを詳しく") ||
    s.includes("Cを深掘り") ||
    s.includes("C案") ||
    s.includes("模擬面接 C")
  ) {
    return "C";
  }

  return null;
}

// ===== Preference Missing-Field Logic =====
const REQUIRED_PREFERENCE_FIELDS = [
  {
    key: "desired_location",
    label: "希望勤務地",
    question:
      "希望勤務地を教えてください。（例：東京23区、大阪市、福岡市、フルリモート希望 など）",
  },
  {
    key: "minimum_salary",
    label: "許容年収下限",
    question:
      "許容年収の下限を教えてください。（例：500万円以上、現年収以上 など）",
  },
  {
    key: "office_attendance",
    label: "出社頻度",
    question:
      "希望する出社頻度を教えてください。（例：フル出社、週3出社、週1出社、フルリモート など）",
  },
  {
    key: "preferred_industries",
    label: "業界希望",
    question:
      "興味のある業界があれば教えてください。（例：IT、人材、SaaS、メーカー など）",
  },
  {
    key: "avoid_points_in_current_job",
    label: "現職で避けたいこと",
    question:
      "次の転職先で避けたいことを教えてください。（例：長時間労働、トップダウン、転勤が多い、テレアポ中心 など）",
  },
];

function normalizeProfile(profile = {}) {
  return {
    experience_keywords: Array.isArray(profile.experience_keywords)
      ? profile.experience_keywords
      : [],
    interest_keywords: Array.isArray(profile.interest_keywords)
      ? profile.interest_keywords
      : [],
    desired_location: profile.desired_location || "",
    minimum_salary: profile.minimum_salary || "",
    office_attendance: profile.office_attendance || "",
    preferred_industries: Array.isArray(profile.preferred_industries)
      ? profile.preferred_industries
      : profile.preferred_industries
      ? [String(profile.preferred_industries)]
      : [],
    avoid_points_in_current_job: Array.isArray(profile.avoid_points_in_current_job)
      ? profile.avoid_points_in_current_job
      : profile.avoid_points_in_current_job
      ? [String(profile.avoid_points_in_current_job)]
      : [],
    waiting_company_template_input: Boolean(profile.waiting_company_template_input),
    waiting_company_template_delete: Boolean(profile.waiting_company_template_delete),
    ...profile,
  };
}

function normalizeInterviewState(interviewState = {}) {
  return {
    pending_preference_questions: Array.isArray(
      interviewState.pending_preference_questions
    )
      ? interviewState.pending_preference_questions
      : [],
    last_asked_preference: interviewState.last_asked_preference || null,
    jobSuggestionStep:
      typeof interviewState.jobSuggestionStep === "number"
        ? interviewState.jobSuggestionStep
        : undefined,
    selectedPlan: ["A", "B", "C"].includes(interviewState.selectedPlan)
      ? interviewState.selectedPlan
      : null,
    lastSelectedPlan: ["A", "B", "C"].includes(interviewState.lastSelectedPlan)
      ? interviewState.lastSelectedPlan
      : null,
    lastOutputType: interviewState.lastOutputType || null,
    lastCompanyTemplate: interviewState.lastCompanyTemplate || null,
    lastQuestion: interviewState.lastQuestion || null,

    mode: interviewState.mode || null,
    startedAt: interviewState.startedAt || null,
    type: interviewState.type || "common",
    strictness: interviewState.strictness || "normal",
    companyTemplate: interviewState.companyTemplate || null,
    companyTemplateName: interviewState.companyTemplateName || null,
    questionIndex:
      typeof interviewState.questionIndex === "number"
        ? interviewState.questionIndex
        : 0,
    answers: Array.isArray(interviewState.answers) ? interviewState.answers : [],
    feedbacks: Array.isArray(interviewState.feedbacks)
      ? interviewState.feedbacks
      : [],
    finalReview: interviewState.finalReview || "",
    isFinished: Boolean(interviewState.isFinished),

    ...interviewState,
  };
}

function isFieldFilled(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v || "").trim()).filter(Boolean).length > 0;
  }
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function getMissingPreferenceFields(profile = {}) {
  const normalized = normalizeProfile(profile);
  return REQUIRED_PREFERENCE_FIELDS.filter(
    (item) => !isFieldFilled(normalized[item.key])
  );
}

function getNextMissingPreferenceQuestion(profile = {}) {
  const missing = getMissingPreferenceFields(profile);
  if (missing.length === 0) return null;

  return {
    key: missing[0].key,
    label: missing[0].label,
    question: missing[0].question,
    remainingKeys: missing.map((item) => item.key),
  };
}

function buildSingleMissingQuestionMessage(profile = {}) {
  const next = getNextMissingPreferenceQuestion(profile);
  if (!next) return "";

  return `\n\n---\nよりマッチ度の高い求人に絞るため、まずは1点だけ教えてください。\n${next.question}\n回答できる範囲で大丈夫です。`;
}

function isLikelySimplePreferenceAnswer(userMessage = "") {
  const t = (userMessage || "").trim();
  if (!t) return false;
  if (detectMenuIntent(t)) return false;
  if (isJobSuggestionContext(t)) return false;

  const longQuestionHints = [
    "どう思う",
    "相談",
    "提案",
    "面接",
    "職務経歴書",
    "自己分析",
    "キャリア",
  ];

  if (longQuestionHints.some((w) => t.includes(w))) return false;
  if (t.length > 100) return false;

  return true;
}

function shouldAskMissingPreferences(aiReply = "", currentTopic = "") {
  const text = String(aiReply || "");

  const proposalHints = [
    "求人",
    "職種例",
    "おすすめ理由",
    "合う点",
    "懸念点",
    "安定寄り",
    "成長寄り",
    "バランス寄り",
    "ポジション",
    "ご提案",
    "一致度",
    "応募優先度",
  ];

  if (currentTopic === "job_suggestion") return true;
  return proposalHints.some((word) => text.includes(word));
}

// ===== Company Template Helpers =====
function getMergedCompanyTemplates(session = null) {
  const customTemplates =
    session?.company_templates && typeof session.company_templates === "object"
      ? session.company_templates
      : {};

  return {
    builtin: MOCK_INTERVIEW_COMPANY_TEMPLATES,
    custom: customTemplates,
  };
}

function isPauseCommand(text = "") {
  const t = (text || "").trim();
  return [
    "一旦止める",
    "止める",
    "停止",
    "一時停止",
    "模擬面接停止",
  ].includes(t);
}

function isResumeCommand(text = "") {
  const t = (text || "").trim();
  return [
    "再開",
    "続き",
    "続きから",
    "再開する",
    "模擬面接再開",
  ].includes(t);
}

function isCompanyTemplateAddCommand(text = "") {
  return (text || "").trim() === "企業テンプレ追加";
}

function isCompanyTemplateListCommand(text = "") {
  return (text || "").trim() === "企業テンプレ一覧";
}

function isCompanyTemplateDeleteCommand(text = "") {
  return (text || "").trim() === "企業テンプレ削除";
}

function extractTemplateUseTarget(text = "") {
  const t = (text || "").trim();

  if (t.startsWith("企業テンプレ使う:")) {
    return t.replace("企業テンプレ使う:", "").trim();
  }

  if (t.startsWith("企業テンプレ:")) {
    return t.replace("企業テンプレ:", "").trim();
  }

  return null;
}

function parseCompanyTemplateText(text = "") {
  const lines = String(text || "")
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean);

  const result = {
    companyName: "",
    industry: "",
    appealPoints: [],
    mockQuestions: [],
    notes: "",
  };

  for (const line of lines) {
    if (line.startsWith("企業名:")) {
      result.companyName = line.replace("企業名:", "").trim();
    } else if (line.startsWith("業界:")) {
      result.industry = line.replace("業界:", "").trim();
    } else if (line.startsWith("訴求ポイント:")) {
      result.appealPoints = line
        .replace("訴求ポイント:", "")
        .split(/[、,]/)
        .map((v) => v.trim())
        .filter(Boolean);
    } else if (line.startsWith("模擬質問:")) {
      result.mockQuestions = line
        .replace("模擬質問:", "")
        .split(/[、,]/)
        .map((v) => v.trim())
        .filter(Boolean);
    } else if (line.startsWith("メモ:")) {
      result.notes = line.replace("メモ:", "").trim();
    }
  }

  if (!result.companyName) return null;
  return result;
}

function getQuestionsFromInterviewState(state = {}, session = null) {
  const interviewState = normalizeInterviewState(state);
  const merged = getMergedCompanyTemplates(session);

  if (
    interviewState.companyTemplateName &&
    merged.custom[interviewState.companyTemplateName] &&
    Array.isArray(merged.custom[interviewState.companyTemplateName].mockQuestions) &&
    merged.custom[interviewState.companyTemplateName].mockQuestions.length > 0
  ) {
    return merged.custom[interviewState.companyTemplateName].mockQuestions;
  }

  if (
    interviewState.companyTemplate &&
    merged.builtin[interviewState.companyTemplate] &&
    Array.isArray(merged.builtin[interviewState.companyTemplate].questions) &&
    merged.builtin[interviewState.companyTemplate].questions.length > 0
  ) {
    return merged.builtin[interviewState.companyTemplate].questions;
  }

  return (
    MOCK_INTERVIEW_QUESTIONS_BY_TYPE[interviewState.type] ||
    MOCK_INTERVIEW_QUESTIONS_BY_TYPE.common
  );
}

function getCompanyTemplateLabelFromState(state = {}, session = null) {
  const interviewState = normalizeInterviewState(state);
  const merged = getMergedCompanyTemplates(session);

  if (
    interviewState.companyTemplateName &&
    merged.custom[interviewState.companyTemplateName]
  ) {
    return interviewState.companyTemplateName;
  }

  if (
    interviewState.companyTemplate &&
    merged.builtin[interviewState.companyTemplate]
  ) {
    return merged.builtin[interviewState.companyTemplate].label;
  }

  return "汎用";
}

// ===== Session / Profile =====
async function getSession(userId) {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("line_ca_sessions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Supabase getSession error:", error.message);
    return null;
  }

  if (!data) return null;

  return {
    ...data,
    profile: normalizeProfile(data.profile || {}),
    interview_state: normalizeInterviewState(data.interview_state || {}),
    current_topic: data.current_topic || null,
    current_stage:
      normalizeSessionStage(data.current_stage) ||
      deriveStageFromTopic(data.current_topic || null),
    current_hypothesis_id: normalizeUuidLike(data.current_hypothesis_id),
    current_job_id: normalizeUuidLike(data.current_job_id),
    active_search_id: normalizeUuidLike(data.active_search_id),
    current_mode: data.current_mode || "normal",
    is_paused: Boolean(data.is_paused),
    paused_state: data.paused_state || {},
    selected_job: data.selected_job || null,
    company_templates:
      data.company_templates && typeof data.company_templates === "object"
        ? data.company_templates
        : {},
  };
}

function mergeUniqueStringArray(a = [], b = []) {
  return [...new Set([...(a || []), ...(b || [])])];
}

function mergeProfile(existing = {}, patch = {}) {
  const base = normalizeProfile(existing);

  return normalizeProfile({
    ...base,
    ...patch,
    experience_keywords: mergeUniqueStringArray(
      base.experience_keywords,
      patch.experience_keywords
    ),
    interest_keywords: mergeUniqueStringArray(
      base.interest_keywords,
      patch.interest_keywords
    ),
    preferred_industries: mergeUniqueStringArray(
      base.preferred_industries,
      patch.preferred_industries
    ),
    avoid_points_in_current_job: mergeUniqueStringArray(
      base.avoid_points_in_current_job,
      patch.avoid_points_in_current_job
    ),
  });
}

async function upsertSession(userId, patch = {}) {
  if (!supabase) return null;

  const current = (await getSession(userId)) || {};

  const mergedInterviewState = {
    ...(current.interview_state || {}),
    ...(patch.interview_state || {}),
  };

  const payload = {
    user_id: userId,
    profile: patch.profile
      ? mergeProfile(current.profile || {}, patch.profile)
      : current.profile || {},
    summary:
      patch.summary !== undefined ? patch.summary : current.summary || "",
    interview_state: mergedInterviewState,
    current_topic:
      patch.current_topic !== undefined
        ? patch.current_topic
        : current.current_topic || null,
    current_stage:
      patch.current_stage !== undefined
        ? patch.current_stage
        : current.current_stage || null,
    plan_type:
      patch.plan_type !== undefined
        ? patch.plan_type
        : current.plan_type || "free",
    usage_count:
      patch.usage_count !== undefined
        ? patch.usage_count
        : current.usage_count || 0,
    selected_job:
      patch.selected_job !== undefined
        ? patch.selected_job
        : current.selected_job || null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("line_ca_sessions")
    .upsert(payload)
    .select()
    .single();

  if (error) {
    console.error("upsertSession error:", error.message);
    return null;
  }

  return data;
}

async function saveCandidateJob({
  userId,
  hypothesisId,
  orderIndex,
  title,
  companyName,
  summary,
}) {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("candidate_jobs")
    .insert({
      user_id: userId,
      hypothesis_id: hypothesisId,
      order_index: orderIndex,
      title,
      company_name: companyName,
      summary,
    })
    .select()
    .single();

  if (error) {
    console.error("saveCandidateJob error:", error.message);
    return null;
  }

  return data;
}

async function saveCandidateHypothesis({
  userId,
  label,
  title,
  summary,
  strengths = [],
  concerns = [],
}) {
  if (!userId || !label) return null;

  const session = (await getSession(userId)) || {};
  const interviewState = normalizeInterviewState(
    session.interview_state || {}
  );

  const updatedHypotheses = {
    ...(interviewState.candidate_hypotheses || {}),
    [label]: {
      label,
      title: title || "",
      summary: summary || "",
      strengths,
      concerns,
      savedAt: new Date().toISOString(),
    },
  };

  await upsertSession(userId, {
    interview_state: {
      ...interviewState,
      candidate_hypotheses: updatedHypotheses,
      current_hypothesis_id: label,
    },
  });

  return updatedHypotheses[label];
}

// ===== Conversation History =====
async function getRecentMessages(userId, limit = 10) {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("line_conversations")
    .select("role, content, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Supabase getRecentMessages error:", error.message);
    return [];
  }

  return (data || []).reverse();
}

async function saveMessage(userId, role, content) {
  if (!supabase) return;

  const { error } = await supabase.from("line_conversations").insert([
    {
      user_id: userId,
      role,
      content,
    },
  ]);

  if (error) {
    console.error("Supabase saveMessage error:", error.message);
  }
}

// ===== Mock Interview Helpers =====
function getDefaultMockInterviewState(type = "common", strictness = "normal") {
  return {
    mode: "mock_interview",
    type,
    strictness,
    companyTemplate: null,
    companyTemplateName: null,
    startedAt: new Date().toISOString(),
    questionIndex: 0,
    answers: [],
    feedbacks: [],
    finalReview: "",
    isFinished: false,
  };
}

function getMockInterviewTypeAndStrictness(userMessage = "", selectedPlan = null) {
  const lower = String(userMessage || "").toLowerCase();

  let type = "common";
  let companyTemplate = null;

if (selectedPlan === "A") {
  type = "revops";
} else if (selectedPlan === "B") {
  type = "planning";
} else if (selectedPlan === "C") {
  type = "cs";
}

  if (
    lower.includes("リクルート") &&
    (lower.includes("ra") || lower.includes("リクルーティングアドバイザー"))
  ) {
    companyTemplate = "recruit_ra";
    type = "ra";
  } else if (
    lower.includes("saas") &&
    (lower.includes("営業企画") || lower.includes("事業企画"))
  ) {
    companyTemplate = "saas_planning";
    type = "planning";
  } else if (lower.includes("saas") && lower.includes("営業")) {
    companyTemplate = "saas_sales";
    type = "sales";
  } else if (lower.includes("人材") && lower.includes("営業")) {
    companyTemplate = "human_sales";
    type = "sales";
  } else if (lower.includes("営業企画") || lower.includes("事業企画")) {
    type = "planning";
  } else if (
    lower.includes("ra") ||
    lower.includes("リクルーティングアドバイザー")
  ) {
    type = "ra";
  } else if (
    lower.includes("cs") ||
    lower.includes("カスタマーサクセス")
  ) {
    type = "cs";
  } else if (lower.includes("営業")) {
    type = "sales";
  }

  let strictness = "normal";
  if (lower.includes("厳しめ")) {
    strictness = "hard";
  } else if (lower.includes("やさしめ")) {
    strictness = "easy";
  }

  return { type, strictness, companyTemplate };
}

async function startMockInterview(
  userId,
  replyToken,
  sessionBefore = null,
  userMessage = ""
) {
  const currentState = normalizeInterviewState(
  sessionBefore?.interview_state || {}
);
const { type, strictness, companyTemplate } =
  getMockInterviewTypeAndStrictness(
    userMessage,
    currentState.selectedPlan || currentState.lastSelectedPlan || null
  );

const selectedPlan =
  currentState.selectedPlan || currentState.lastSelectedPlan || null;

const selectedJob =
  currentState.selected_job || sessionBefore?.selected_job || null;

let resolvedType = type;
let resolvedCompanyTemplate = companyTemplate;

if (selectedPlan === "B" && selectedJob === "job1") {
  resolvedType = "bizops_manufacturing_dx";
  resolvedCompanyTemplate = "manufacturing_dx_bizops";
} else if (selectedPlan === "B" && selectedJob === "job2") {
  resolvedType = "revops_hrtech";
  resolvedCompanyTemplate = "hrtech_revops";
}

  const customTemplateName =
    !companyTemplate && currentState.companyTemplateName
      ? currentState.companyTemplateName
      : null;

  const newState = {
  ...currentState,
  ...getDefaultMockInterviewState(resolvedType, strictness),
  companyTemplate: resolvedCompanyTemplate || null,
  companyTemplateName: customTemplateName,
  lastOutputType: "mock_interview_start",
  lastCompanyTemplate: resolvedCompanyTemplate || customTemplateName || null,
};

  const questions = getQuestionsFromInterviewState(newState, sessionBefore);

  await upsertSession(userId, {
    current_topic: "mock_interview",
    current_mode: "mock_interview",
    is_paused: false,
    paused_state: {},
    interview_state: newState,
  });

  const typeLabelMap = {
  common: "一般",
  sales: "営業",
  revops: "営業企画・RevOps",
  cs: "カスタマーサクセス",
  planning: "営業企画・事業企画",
  ra: "RA",
  bizops_manufacturing_dx: "BizOps / CS Ops（製造DX）",
  revops_hrtech: "RevOps（HRTech）",
};

  const strictnessLabelMap = {
    easy: "やさしめ",
    normal: "通常",
    hard: "厳しめ",
  };

  const companyLabel = getCompanyTemplateLabelFromState(newState, sessionBefore);

  const reply = `模擬面接モードを開始します。

【設定】
テンプレ：${companyLabel}
職種：${typeLabelMap[resolvedType]}
厳しさ：${strictnessLabelMap[strictness]}

私が面接官として1問ずつ質問します。
できるだけ本番のつもりで回答してください。
途中でやめるときは「終了」と送ってください。
一時停止したいときは「一旦止める」と送ってください。

【第1問】
${questions[0]}`;

  await saveMessage(userId, "assistant", reply);
  await replyToLine(replyToken, reply);
}

async function evaluateMockAnswer(
  question,
  answer,
  strictness = "normal",
  profile = {},
  summary = ""
) {
  try {
    const strictnessPrompt = {
      easy: "やさしめに評価し、良い点を多めに伝えてください。",
      normal: "実務的かつバランス良く評価してください。",
      hard:
        "面接官としてかなり厳しめに評価し、曖昧さ・抽象さ・弱い表現を厳しく指摘してください。",
    };

    const prompt = `
あなたは非常に優秀な採用面接官です。
${strictnessPrompt[strictness]}

以下の質問と回答に対して、具体的かつ実践的にフィードバックしてください。

候補者プロフィール:
${JSON.stringify(profile, null, 2)}

候補者サマリー:
${summary || "なし"}

【質問】
${question}

【回答】
${answer}

以下の形式で日本語で返してください。

【面接官評価】
- 論理性：1〜5
- 具体性：1〜5
- 再現性：1〜5
- 職種適性：1〜5

【良い点】
- 箇条書きで2〜3点

【改善点】
- 箇条書きで2〜3点

【改善回答例】
- 面接でそのまま使える自然な回答例を3〜6文程度
ルール:
- 簡潔で実践的に
- 甘すぎる評価にしない
- ただし否定的すぎず、改善可能な形で返す
- 候補者が明示していない数値・成果・役職・KPIは絶対に創作しない
- 数字が不明な場合は「具体的な実績を補足すると良い」と伝える
- 改善回答例でも、事実未確認の数字は使わない
`;

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "あなたは一流企業の採用面接官です。厳しくても建設的にフィードバックしてください。",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    return (
      completion.choices?.[0]?.message?.content?.trim() ||
      "フィードバックを生成できませんでした。"
    );
  } catch (error) {
    console.error("evaluateMockAnswer error:", error.response?.data || error.message);
    return "フィードバック生成中にエラーが発生しました。";
  }
}

async function generateMockInterviewFinalReview(
  interviewState,
  profile = {},
  summary = ""
) {
  try {
    const answers = Array.isArray(interviewState?.answers) ? interviewState.answers : [];

    const formatted = answers
      .map((item, i) => {
        return `【Q${i + 1}】${item.question}\n【A${i + 1}】${item.answer}`;
      })
      .join("\n\n");

    const strictnessPrompt = {
      easy: "やや前向きに、伸びしろも含めて評価してください。",
      normal: "実務的かつバランス良く評価してください。",
      hard: "かなり厳しめに、通過しない理由も明確に評価してください。",
    };

    const prompt = `
あなたは非常に優秀な採用面接官です。
${strictnessPrompt[interviewState?.strictness || "normal"]}

以下は模擬面接の回答一覧です。全体を見て、実際の面接官のように総評してください。

候補者プロフィール:
${JSON.stringify(profile, null, 2)}

候補者サマリー:
${summary || "なし"}

${formatted}

以下の形式で日本語で返してください。

【総評】
- 全体の印象を3〜5文

【評価】
- 伝わりやすさ：
- 論理性：
- 熱意：
- 再現性：

【通過可能性】
- 書類通過：0〜100%
- 一次面接通過：0〜100%
- 最終面接通過：0〜100%
- 理由：1〜2文

【面接官が懸念しそうな点】
- 箇条書きで3点

【落ちる可能性がある理由】
- 箇条書きで3点

【強み】
- 箇条書きで3点

【次回までに直すべきこと TOP3】
1.
2.
3.

ルール:
- 簡潔で実践的に
- 面接官視点で厳しめだが建設的に
- 候補者が明示していない数値・成果・役職・KPIは絶対に創作しない
- 通過可能性は 0〜100% の整数で表現する
- 「なぜその評価なのか」を必ず書く
- 曖昧な褒めだけで終わらせず、落ちる理由も明確に書く
`;

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "あなたは一流企業の採用面接官です。実務的に厳しめに評価してください。",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    return (
      completion.choices?.[0]?.message?.content?.trim() ||
      "総評を生成できませんでした。"
    );
  } catch (error) {
    console.error(
      "generateMockInterviewFinalReview error:",
      error.response?.data || error.message
    );
    return "総評生成中にエラーが発生しました。";
  }
}

async function handleMockInterviewReview(userId, replyToken, userMessage) {
  try {
    const session = await getSession(userId);
    const state = normalizeInterviewState(session?.interview_state || {});

    if (!state.answers || state.answers.length === 0) {
      await replyToLine(
        replyToken,
        "前回の模擬面接データが見つかりませんでした。まずは模擬面接を実施してください。"
      );
      return;
    }
if (userMessage.includes("前回との比較")) {
  const history = Array.isArray(state.reviewHistory)
    ? state.reviewHistory
    : [];

  if (history.length < 2) {
    await replyToLine(
      replyToken,
      "比較できるだけの面接履歴がありません。2回以上模擬面接を実施してください。"
    );
    return;
  }

  const previous = history[history.length - 2].review;
  const latest = history[history.length - 1].review;

  const prompt = `
あなたは厳しめの面接官です。

以下の2回分の模擬面接総評を比較し、
「改善した点」「まだ弱い点」「次回最優先で直すこと」を簡潔にまとめてください。

【前回】
${previous}

【今回】
${latest}

出力形式:
【改善した点】
- 3点以内

【まだ弱い点】
- 3点以内

【次回最優先で直すこと】
1.
2.
3.
`;

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "あなたは一流企業の採用面接官です。実務的に比較してください。",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const compareText =
    completion.choices?.[0]?.message?.content?.trim() ||
    "比較を生成できませんでした。";

  await replyToLine(replyToken, compareText);
  return;
}

    if (userMessage.includes("前回の模擬面接")) {
      const startIndex = Math.max(0, state.answers.length - 3);
      const recentAnswers = state.answers
        .slice(-3)
        .map((item, index) => {
          return `【質問${startIndex + index + 1}】
${item.question}

【あなたの回答】
${item.answer}`;
        })
        .join("\n\n--------------------\n\n");

      const finalReview = state.finalReview
        ? `\n\n====================\n【前回の総評】\n${state.finalReview}`
        : "";

      const reply = `前回の模擬面接を振り返ります。

${recentAnswers}${finalReview}`;

      await saveMessage(userId, "assistant", reply);
      await replyToLine(replyToken, reply);
      return;
    }

    if (userMessage.includes("前回の改善点")) {
      const finalReview = state.finalReview || "";

      if (!finalReview) {
        const reply =
          "前回の改善点が見つかりませんでした。模擬面接を最後まで実施してください。";
        await saveMessage(userId, "assistant", reply);
        await replyToLine(replyToken, reply);
        return;
      }

      const prompt = `
以下は前回の模擬面接の総評です。

${finalReview}

この内容から、
- 最も改善すべきポイント3つ
- 具体的にどう直せばいいか
- 次回の面接で意識する一言

を簡潔にまとめてください。
`;

      const completion = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          {
            role: "system",
            content:
              "あなたは一流の面接コーチです。簡潔かつ実践的に改善点を整理してください。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const result =
        completion.choices?.[0]?.message?.content?.trim() ||
        "改善点を取得できませんでした。";

      const reply = `【前回の改善点】
${result}`;

      await saveMessage(userId, "assistant", reply);
      await replyToLine(replyToken, reply);
      return;
    }

    if (userMessage.includes("前回との比較")) {
      if (!state.answers || state.answers.length < 2) {
        const reply =
          "比較できる十分な模擬面接データがありません。複数回答後にお試しください。";
        await saveMessage(userId, "assistant", reply);
        await replyToLine(replyToken, reply);
        return;
      }

      const prompt = `
以下は模擬面接の最近の回答です。

${state.answers
  .slice(-2)
  .map(
    (item, index) =>
      `【回答${index + 1}】
質問: ${item.question}
回答: ${item.answer}`
  )
  .join("\n\n")}

この2つを比較し、
- 良くなった点
- まだ弱い点
- 次回さらに改善するポイント

を簡潔にまとめてください。
`;

      const completion = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          {
            role: "system",
            content:
              "あなたは一流の面接コーチです。成長と改善点を具体的に比較してください。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const result =
        completion.choices?.[0]?.message?.content?.trim() ||
        "比較結果を取得できませんでした。";

      const reply = `【前回との比較】
${result}`;

      await saveMessage(userId, "assistant", reply);
      await replyToLine(replyToken, reply);
      return;
    }

    const fallback =
      "前回の模擬面接 / 前回の改善点 / 前回との比較 のいずれかを送ってください。";
    await saveMessage(userId, "assistant", fallback);
    await replyToLine(replyToken, fallback);
  } catch (error) {
    console.error("handleMockInterviewReview error:", error);

    const reply = "前回の模擬面接データの取得中にエラーが発生しました。";
    await saveMessage(userId, "assistant", reply);
    await replyToLine(replyToken, reply);
  }
}

async function handleAnswerPolish(userId, replyToken, userMessage) {
  try {
    const history = await getRecentMessages(userId, 12);
    const session = await getSession(userId);
    const profile = normalizeProfile(session?.profile || {});
    const summary = session?.summary || "";

    const recentUserMessages = history
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .filter(Boolean);

    let targetAnswer = "";
    for (let i = recentUserMessages.length - 1; i >= 0; i--) {
      const msg = recentUserMessages[i];
      if (!detectAnswerPolishCommand(msg)) {
        targetAnswer = msg;
        break;
      }
    }

    if (!targetAnswer) {
      const reply =
        "添削対象の回答が見つかりませんでした。先に回答文を送ったあとで「この回答を添削して」と送ってください。";
      await saveMessage(userId, "assistant", reply);
      await replyToLine(replyToken, reply);
      return;
    }

    let toneInstruction = "実務的かつバランス良く添削してください。";
    if (userMessage.includes("厳しめ")) {
      toneInstruction =
        "面接官視点で厳しめに添削し、弱い表現や抽象表現を明確に修正してください。";
    } else if (
      userMessage.includes("通過率が上がる") ||
      userMessage.includes("面接向け") ||
      userMessage.includes("面接用")
    ) {
      toneInstruction =
        "面接通過率が上がるように、説得力・再現性・具体性を強めて添削してください。";
    }

    const prompt = `
あなたは非常に優秀な面接コーチです。
${toneInstruction}

候補者プロフィール:
${JSON.stringify(profile, null, 2)}

候補者サマリー:
${summary || "なし"}

添削対象の回答:
${targetAnswer}

以下の形式で日本語で返してください。

【元の回答の弱い点】
- 2〜3点

【改善のポイント】
- 2〜3点

【添削後の回答】
- 面接でそのまま話せる自然な文章

ルール:
- 候補者が明示していない数値・成果・役職・KPIは創作しない
- 抽象表現はなるべく具体化する
- ただし事実にないことは足さない
- 口頭で話しやすい長さにする
`;

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "あなたは一流の面接コーチです。厳しくても建設的に回答添削を行ってください。",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const result =
      completion.choices?.[0]?.message?.content?.trim() ||
      "添削結果を生成できませんでした。";

    const reply = `【回答添削】
${result}`;

    await saveMessage(userId, "assistant", reply);
    await replyToLine(replyToken, reply);
  } catch (error) {
    console.error("handleAnswerPolish error:", error);

    const reply = "回答添削中にエラーが発生しました。";
    await saveMessage(userId, "assistant", reply);
    await replyToLine(replyToken, reply);
  }
}

async function handleMockInterviewAnswer(
  userId,
  replyToken,
  session,
  userMessage
) {
  const interviewState = normalizeInterviewState(session?.interview_state || {});
  const profile = normalizeProfile(session?.profile || {});
  const summary = session?.summary || "";

  if (userMessage.trim() === "終了") {
  const endedState = {
    ...interviewState,
    mode: null,
    isFinished: true,
    lastOutputType: "mock_interview_end",
  };

  const finalReview = await generateMockInterviewFinalReview(
    {
      ...endedState,
      answers: Array.isArray(interviewState.answers) ? interviewState.answers : [],
    },
    profile,
    summary
  );

 endedState.finalReview = finalReview;

const reviewHistory = Array.isArray(endedState.reviewHistory)
  ? endedState.reviewHistory
  : [];

reviewHistory.push({
  createdAt: new Date().toISOString(),
  review: finalReview,
});

endedState.reviewHistory = reviewHistory.slice(-5);

await upsertSession(userId, {
  current_topic: null,
  current_mode: "normal",
  is_paused: false,
  paused_state: {},
  interview_state: endedState,
});

  const reply = `模擬面接モードを終了しました。お疲れさまでした。

====================
【途中終了時点の総評】
${finalReview}

---
${getNextActionMenuByTopic("mock_interview")}`;

  await saveMessage(userId, "assistant", reply);
  await replyToLine(replyToken, reply);
  return;
}

  const questions = getQuestionsFromInterviewState(interviewState, session);
  const currentIndex = interviewState.questionIndex || 0;
  const currentQuestion = questions[currentIndex];

  const feedback = await evaluateMockAnswer(
    currentQuestion,
    userMessage,
    interviewState.strictness || "normal",
    profile,
    summary
  );

  const nextAnswers = [
    ...(Array.isArray(interviewState.answers) ? interviewState.answers : []),
    {
      question: currentQuestion,
      answer: userMessage,
    },
  ];

  const nextFeedbacks = [
    ...(Array.isArray(interviewState.feedbacks) ? interviewState.feedbacks : []),
    feedback,
  ];

  const nextIndex = currentIndex + 1;

  if (nextIndex >= questions.length) {
    const finalState = {
      ...interviewState,
      mode: null,
      questionIndex: nextIndex,
      answers: nextAnswers,
      feedbacks: nextFeedbacks,
      isFinished: true,
      lastQuestion: currentQuestion,
      lastOutputType: "mock_interview_final",
    };

    const finalReview = await generateMockInterviewFinalReview(
      finalState,
      profile,
      summary
    );

    finalState.finalReview = finalReview;

    await upsertSession(userId, {
      current_topic: null,
      current_mode: "normal",
      is_paused: false,
      paused_state: {},
      interview_state: finalState,
    });

    const reply = `【今回のフィードバック】
${feedback}

====================
【模擬面接 総評】
${finalReview}

面接官視点では、上記の「懸念点」と「落ちる可能性がある理由」を先に潰すと、通過率はかなり上がります。

---
${getNextActionMenuByTopic("mock_interview")}`;

    await saveMessage(userId, "assistant", reply);
    await replyToLine(replyToken, reply);
    return;
  }

  const nextQuestion = questions[nextIndex];

  const nextState = {
    ...interviewState,
    mode: "mock_interview",
    questionIndex: nextIndex,
    answers: nextAnswers,
    feedbacks: nextFeedbacks,
    isFinished: false,
    lastQuestion: currentQuestion,
    lastOutputType: "mock_interview_feedback",
  };

  await upsertSession(userId, {
    current_topic: "mock_interview",
    current_mode: "mock_interview",
    is_paused: false,
    paused_state: {},
    interview_state: nextState,
  });

  const reply = `【フィードバック】
${feedback}

【次の質問】
${nextQuestion}`;

  await saveMessage(userId, "assistant", reply);
  await replyToLine(replyToken, reply);
}

async function handlePauseMockInterview(userId, replyToken, session) {
  const state = normalizeInterviewState(session?.interview_state || {});

  if (state.mode !== "mock_interview" || state.isFinished) {
    const reply =
      "今は模擬面接中ではありません。始める場合は「模擬面接」と送ってください。";
    await saveMessage(userId, "assistant", reply);
    await replyToLine(replyToken, reply);
    return;
  }

  await upsertSession(userId, {
    current_mode: "normal",
    is_paused: true,
    paused_state: {
      pausedAt: new Date().toISOString(),
      current_mode: "mock_interview",
      interview_state: state,
    },
  });

  const reply =
    "模擬面接を一時停止しました。\n再開したいときは「再開」と送ってください。";
  await saveMessage(userId, "assistant", reply);
  await replyToLine(replyToken, reply);
}

async function handleResumeMockInterview(userId, replyToken, session) {
  const pausedState = session?.paused_state || {};
  const restoredState = normalizeInterviewState(
    pausedState.interview_state || session?.interview_state || {}
  );

  if (!session?.is_paused) {
    const reply =
      "今は一時停止中の模擬面接はありません。始める場合は「模擬面接」と送ってください。";
    await saveMessage(userId, "assistant", reply);
    await replyToLine(replyToken, reply);
    return;
  }

  const questions = getQuestionsFromInterviewState(restoredState, session);
  const currentIndex = restoredState.questionIndex || 0;
  const nextQuestion = questions[currentIndex];

  await upsertSession(userId, {
    current_topic: "mock_interview",
    current_mode: "mock_interview",
    is_paused: false,
    paused_state: {},
    interview_state: {
      ...restoredState,
      mode: "mock_interview",
      isFinished: false,
      lastOutputType: "mock_interview_resume",
    },
  });

  const reply = `模擬面接を再開します。

【続きの質問】
${nextQuestion}`;

  await saveMessage(userId, "assistant", reply);
  await replyToLine(replyToken, reply);
}

async function handleCompanyTemplateAddStart(userId, replyToken, session) {
  await upsertSession(userId, {
    profile: {
      ...(session?.profile || {}),
      waiting_company_template_input: true,
      waiting_company_template_delete: false,
    },
  });

  const reply = `企業テンプレ追加モードに入りました。
以下の形式で送ってください。

企業名: リクルート
業界: 人材 / HRTech
訴求ポイント: 社会影響が大きい、営業→企画へ広がる、顧客課題の深掘り
模擬質問: なぜリクルート？、転職理由は？、営業経験をどう活かす？
メモ: 深掘り多め`;

  await saveMessage(userId, "assistant", reply);
  await replyToLine(replyToken, reply);
}

async function handleCompanyTemplateInput(userId, replyToken, session, userMessage) {
  const parsed = parseCompanyTemplateText(userMessage);

  if (!parsed) {
    const reply =
      "企業テンプレの形式が読み取れませんでした。\n「企業名: ○○」を含めて、指定フォーマットで送ってください。";
    await saveMessage(userId, "assistant", reply);
    await replyToLine(replyToken, reply);
    return;
  }

  const currentTemplates = session?.company_templates || {};

  const nextTemplates = {
    ...currentTemplates,
    [parsed.companyName]: parsed,
  };

  await upsertSession(userId, {
    company_templates: nextTemplates,
    profile: {
      ...(session?.profile || {}),
      waiting_company_template_input: false,
    },
  });

  const reply = `企業テンプレ「${parsed.companyName}」を保存しました。
使うときは「企業テンプレ: ${parsed.companyName}」と送ってください。`;

  await saveMessage(userId, "assistant", reply);
  await replyToLine(replyToken, reply);
}

async function handleCompanyTemplateList(userId, replyToken, session) {
  const templates = session?.company_templates || {};
  const names = Object.keys(templates);

  if (names.length === 0) {
    const reply =
      "保存されている企業テンプレはまだありません。追加する場合は「企業テンプレ追加」と送ってください。";
    await saveMessage(userId, "assistant", reply);
    await replyToLine(replyToken, reply);
    return;
  }

  const text = [
    "保存中の企業テンプレ一覧です。",
    ...names.map((name, i) => `${i + 1}. ${name}`),
    "",
    "使う場合は「企業テンプレ: 企業名」と送ってください。",
  ].join("\n");

  await saveMessage(userId, "assistant", text);
  await replyToLine(replyToken, text);
}

async function handleCompanyTemplateSelect(userId, replyToken, session, templateName) {
  const templates = session?.company_templates || {};
  const selected = templates[templateName];

  if (!selected) {
    const reply = `「${templateName}」の企業テンプレは見つかりませんでした。
「企業テンプレ一覧」で確認してください。`;
    await saveMessage(userId, "assistant", reply);
    await replyToLine(replyToken, reply);
    return;
  }

  await upsertSession(userId, {
    interview_state: {
      ...(session?.interview_state || {}),
      companyTemplate: null,
      companyTemplateName: templateName,
      lastCompanyTemplate: templateName,
      lastOutputType: "company_template_select",
    },
  });

  const message = [
    `企業テンプレ「${templateName}」を読み込みました。`,
    `業界: ${selected.industry || "未設定"}`,
    `訴求ポイント: ${(selected.appealPoints || []).join(" / ") || "未設定"}`,
    `想定質問: ${(selected.mockQuestions || []).join(" / ") || "未設定"}`,
    `メモ: ${selected.notes || "なし"}`,
    "",
    "模擬面接を始めるときは「模擬面接」と送ってください。",
  ].join("\n");

  await saveMessage(userId, "assistant", message);
  await replyToLine(replyToken, message);
}

async function handleCompanyTemplateDeleteStart(userId, replyToken, session) {
  await upsertSession(userId, {
    profile: {
      ...(session?.profile || {}),
      waiting_company_template_delete: true,
      waiting_company_template_input: false,
    },
  });

  const reply =
    "削除したい企業名を「削除: 企業名」の形式で送ってください。\n例: 削除: リクルート";
  await saveMessage(userId, "assistant", reply);
  await replyToLine(replyToken, reply);
}

async function handleCompanyTemplateDeleteExecute(
  userId,
  replyToken,
  session,
  userMessage
) {
  const companyName = String(userMessage || "").replace("削除:", "").trim();
  const templates = { ...(session?.company_templates || {}) };

  if (!templates[companyName]) {
    const reply = `「${companyName}」の企業テンプレは見つかりませんでした。`;
    await saveMessage(userId, "assistant", reply);
    await replyToLine(replyToken, reply);
    return;
  }

  delete templates[companyName];

  await upsertSession(userId, {
    company_templates: templates,
    profile: {
      ...(session?.profile || {}),
      waiting_company_template_delete: false,
    },
    interview_state: {
      ...(session?.interview_state || {}),
      companyTemplateName:
        session?.interview_state?.companyTemplateName === companyName
          ? null
          : session?.interview_state?.companyTemplateName || null,
      lastOutputType: "company_template_delete",
    },
  });

  const reply = `企業テンプレ「${companyName}」を削除しました。`;
  await saveMessage(userId, "assistant", reply);
  await replyToLine(replyToken, reply);
}

// ===== Job Suggestion Prompt Builders =====
function buildConditionStatusInstruction(profile = {}) {
  const p = normalizeProfile(profile);

  return `
このユーザーの希望条件の取得状況です。
求人提案の最後に付ける【次に確認したいこと】では、未取得のものだけを書くこと。

取得済み:
- 希望勤務地: ${isFieldFilled(p.desired_location) ? "取得済み" : "未取得"}
- 許容年収下限: ${isFieldFilled(p.minimum_salary) ? "取得済み" : "未取得"}
- 出社頻度: ${isFieldFilled(p.office_attendance) ? "取得済み" : "未取得"}
- 業界希望: ${isFieldFilled(p.preferred_industries) ? "取得済み" : "未取得"}
- 現職で避けたいこと: ${isFieldFilled(p.avoid_points_in_current_job) ? "取得済み" : "未取得"}

重要ルール:
- 取得済みの項目は【次に確認したいこと】に絶対に書かない
- 未取得項目がない場合は【次に確認したいこと】自体を書かない
- 以下の項目は【次に確認したいこと】として勝手に追加しない
  - どのくらい企画寄りに行きたいか
  - マネジメントか専門性か
  - 理想年収
  - 業界追加希望
  - リモート条件の再確認
`;
}

function detectCareerTrack(profile = {}, summary = "") {
  const text =
    JSON.stringify(profile || {}) + " " + String(summary || "");

  if (
    text.includes("営業") ||
    text.includes("法人営業") ||
    text.includes("RA") ||
    text.includes("SaaS営業")
  ) {
    return "sales";
  }

  if (
    text.includes("生産技術") ||
    text.includes("生産管理") ||
    text.includes("設備導入") ||
    text.includes("製造")
  ) {
    return "manufacturing";
  }

  if (
    text.includes("エンジニア") ||
    text.includes("開発") ||
    text.includes("システム") ||
    text.includes("SE")
  ) {
    return "engineer";
  }

  if (
    text.includes("経理") ||
    text.includes("財務") ||
    text.includes("人事") ||
    text.includes("総務")
  ) {
    return "corporate";
  }

  return "beginner";
}

function buildJobSuggestionInstruction(profile = {}, summary = "") {
  const track = detectCareerTrack(profile, summary);

  const trackInstruction =
    track === "sales"
      ? `
追加ルール（営業タイプ）：
- 営業経験を活かして企画寄りに進む前提で提案する
- 営業企画 / RevOps / BizOps / CS企画 を優先する
- SaaS、人材SaaS、HRTech、製造DXを優先する
- 既に取得済みの条件を再確認する質問はしない
- 「まずは第一希望の職種を教えてください」のような追加質問はしない
- 3案は、営業経験をベースに少しずつ難易度と成長性を変える
`
      : track === "manufacturing"
      ? `
追加ルール（製造タイプ）：
- 生産技術 / 生産管理 / 設備導入の経験を強みとして扱う
- 製造DX、設備改善、CS Ops、BizOps、業務改善企画を優先する
- 現場理解と運用定着力を活かせる提案にする
- 既に取得済みの条件を再確認する質問はしない
`
      : track === "engineer"
      ? `
追加ルール（エンジニアタイプ）：
- PM、PdM、IT企画、開発PMO、技術コンサルを優先する
- 技術経験を活かしつつ上流に行ける提案にする
- 既に取得済みの条件を再確認する質問はしない
`
      : track === "corporate"
      ? `
追加ルール（コーポレートタイプ）：
- 経営企画、管理会計、FP&A、業務企画、人事企画を優先する
- 管理部門経験を活かしつつ、企画・改善に寄せる提案にする
- 既に取得済みの条件を再確認する質問はしない
`
      : `
追加ルール（汎用タイプ）：
- 未経験でも挑戦しやすい順に3案を出す
- 既に取得済みの条件を再確認する質問はしない
`;

  return `
今回は「求人提案」として回答してください。
現在のユーザータイプ: ${track}

${trackInstruction}

出力ルール：
- 冒頭に一文だけ自然な導入文を入れてよい
- 導入文の例：
  「ありがとうございます！あなたの希望条件に基づいて、以下の求人提案を考えてみました。」
- ただし謝罪文・言い訳・「再度」「失礼しました」などの表現は禁止
- LINEで読みやすい見出し付き
- 必ず3パターンで提案する
- 順番は以下で固定
- 各案に必ず「一致度：xx%」をつける
- 各案に必ず「応募優先度：高 / 中 / 低」をつける
- 一致度は、業界・年収・勤務地・出社頻度・避けたいこと・経験との整合を踏まえて相対評価する
- 応募優先度は、一致度だけでなく、選考通過しやすさ・再現性・未経験要素の少なさも踏まえてつける
- 一致度と応募優先度は絶対に省略しない
- A/B/Cの全案で必ず同じ形式を守る

出力フォーマット：
ありがとうございます！あなたの希望条件に基づいて、以下の求人提案を考えてみました。

【A. 安定寄り】一致度：xx% / 応募優先度：高・中・低
職種例：
- ・・・
- ・・・

- おすすめ理由
- 合う点
- 一致理由
- 応募優先度の理由
- 懸念点

【B. 成長寄り】一致度：xx% / 応募優先度：高・中・低
職種例：
- ・・・
- ・・・

- おすすめ理由
- 合う点
- 一致理由
- 応募優先度の理由
- 懸念点

【C. バランス寄り】一致度：xx% / 応募優先度：高・中・低
職種例：
- ・・・
- ・・・

- おすすめ理由
- 合う点
- 一致理由
- 応募優先度の理由
- 懸念点

【おすすめ応募順】
A → B → C

最後は必ず以下で締めること：

気になる案があれば、A / B / C のどれかを送ってください。
例：
- Aが気になる
- Bを詳しく知りたい
- Cを深掘りしたい

まだ迷う場合は「おすすめ順に詳しく」と送っていただければ、こちらで順番に深掘りします。

最後は必要な場合のみ
【次に確認したいこと】
を付ける

一致理由のルール：
- できるだけ以下の観点で簡潔に書く
  - 業界一致
  - 年収条件との整合
  - 出社頻度との整合
  - 希望勤務地との整合
  - 避けたい環境との相性
- すべて無理に書かなくてよいが relevant なものは優先して書く

応募優先度の理由のルール：
- 高:
  今の条件とのズレが少なく、選考通過率も比較的見込みやすい
- 中:
  魅力は大きいが、未経験要素や選考難易度に少しハードルがある
- 低:
  方向性としてはあり得るが、今の条件とのズレや難易度がやや高い
- 各案ごとに、なぜ高・中・低なのかを一言で説明する

追加ルール：
- 実在求人の断定はしない
- 今は「どういう求人が合いそうか」の提案でよい
- ユーザーの profile と summary を優先して使う
- 特に preferred_industries がある場合は、必ずその業界を前提に職種例・理由・合う点を書く
- preferred_industries が ["SaaS","人材"] の場合は、SaaS企業・人材会社を前提にする
- desired_location がある場合は勤務地に反映する
- minimum_salary がある場合は年収条件に反映する
- office_attendance がある場合は、出社頻度に合う求人だけを前提にする
- avoid_points_in_current_job がある場合は、その要素を避けた求人として書く
- avoid_points_in_current_job がある場合は、懸念点だけでなく「おすすめ理由」「合う点」「一致理由」にも反映し、その環境を避けやすい理由を書く
- profile にない条件を勝手に補わない
- ユーザーが明示していない経験は断定しない
- 「〜経験を活かせる」と言い切れない場合は、「〜志向と親和性が高い」「〜に挑戦しやすい」と表現する
- 3案の違いがはっきり分かるようにする
- 必ずA/B/Cの順番で出す
- 1案あたり長くしすぎない
- LINEで読みやすいように、空行と箇条書きを使う
- 各案の職種例は、可能なら業界名も入れる
- 取得済み条件は【次に確認したいこと】に書かない
- 未取得項目がない場合は【次に確認したいこと】を出さない
- 「一致度」「応募優先度」が1つでも欠けたら不正な出力
- 省略表現を使わず、A/B/Cすべてに完全な項目を入れる
- 「気になる職種があればお知らせください」のような曖昧な締め方はしない

${buildConditionStatusInstruction(profile)}
`;
}

function buildJobSuggestionFollowupInstruction(profile = {}, selectedPlan = "A") {
  const track = detectCareerTrack(profile, "");

 const trackInstruction =
  track === "sales"
    ? `
- 営業経験を前提に深掘りする
- 営業企画 / RevOps / BizOps / CS企画 につながる説明にする
- 「営業から企画寄りにどうスライドするか」を必ず入れる
`
    : track === "manufacturing"
    ? `
- 製造経験を前提に深掘りする
- 製造DX、設備改善、運用定着、現場巻き込みを必ず入れる
`
    : "";

  return `
${trackInstruction}

今回は「求人提案の深掘り」です。
ユーザーは ${selectedPlan} 案を詳しく見たいと考えています。

重要ルール：
- 前回のA/B/C提案全文を繰り返さない
- 今回は ${selectedPlan} 案だけを深掘りする
- profile にない事実は断定しない
- ユーザーが明示していない経験は断定しない
- 別業種・別職種の場合は、その職種に合わせて内容を変える
- 「営業企画・RevOps」に固定しない
- LINEで読みやすく、箇条書きを中心にする
- 最後は必ず次アクションを出す
- 次アクションは selectedPlan を使って動的に出す

出力フォーマット：

ありがとうございます。まずは ${selectedPlan} 案を深掘りします。

【今回深掘りする案】
${selectedPlan}. ${selectedPlan}

【向いている人】
- ・・・
- ・・・

【想定される仕事内容】
- ・・・
- ・・・

【年収レンジの目安】
- ・・・

【この人が通過しやすい理由】
- ・・・
- ・・・

【落ちやすいポイント】
- ・・・
- ・・・

【受けるなら狙い目の企業イメージ】
- ・・・
- ・・・

【次に進めます】
1. 具体求人3件を出す
2. ${selectedPlan}向けの職務経歴書を作る
3. ${selectedPlan}向けの面接対策をする
4. 模擬面接を始める

または
・具体求人3件
・職務経歴書
・面接対策
と送ってください。

現在のプロフィール:
${JSON.stringify(profile, null, 2)}
`;
}

function isConcreteThreeJobsRequest(text = "") {
  const t = String(text || "").trim();

  return (
    t.includes("具体求人3件") ||
    t.includes("具体的な求人3件") ||
    t.includes("具体求人を3件") ||
    t.includes("求人3件") ||
    t.includes("3件出して") ||
    t.includes("3件提案") ||
    t.includes("具体求人")
  );
}

function isSpecificJobResumeRequest(text = "") {
  const s = String(text || "").trim();

  return (
    s.includes("求人1向けの職務経歴書") ||
    s.includes("求人2向けの職務経歴書") ||
    s.includes("求人3向けの職務経歴書") ||
    s.includes("向けの職務経歴書を作って")
  );
}

function detectSelectedJob(text = "") {
  const s = String(text || "").trim();

  if (
    s.includes("求人1") ||
    s.includes("1向け") ||
    s === "1"
  ) {
    return "job1";
  }

  if (
    s.includes("求人2") ||
    s.includes("2向け") ||
    s === "2"
  ) {
    return "job2";
  }

  if (
    s.includes("求人3") ||
    s.includes("3向け") ||
    s === "3"
  ) {
    return "job3";
  }

  return null;
}

function buildConcreteThreeJobsInstruction(profile = {}, selectedPlan = "A", summary = "") {
  const track = detectCareerTrack(profile, summary);

  const trackInstruction =
    track === "sales"
      ? `
追加ルール（営業タイプ）：
- 営業経験を前提に、営業企画 / RevOps / BizOps / CS企画 に寄せて3件出す
- 「営業→企画へスライドしやすい順」で3件を並べる
- SaaS、人材SaaS、HRTech、製造DXを優先する
`
      : track === "manufacturing"
      ? `
追加ルール（製造タイプ）：
- 製造経験を前提に、製造DX / 設備改善 / BizOps / CS Ops に寄せて3件出す
- 現場理解、設備導入、運用定着を活かせる求人を優先する
`
      : "";

  const planMap = {
    A: "営業企画 / RevOps / カスタマーサクセス企画",
    B: "事業企画 / BizOps / 新規事業開発",
    C: "マーケティング企画 / 営業企画 / パートナーセールス",
  };

  const planLabel = planMap[selectedPlan] || "企画系職種";

  return `
今回は「具体求人3件の提案」です。
ユーザーは ${selectedPlan} 案を前提に、より具体的な求人イメージを3件見たいと考えています。

${trackInstruction}

重要ルール：
- 実在企業の断定はしない
- ただし「実際にありそうな求人票レベル」で具体化する
- profile にない事実を足さない
- ユーザーが明示していない経験を断定しない
- LINEで読みやすく、3件を明確に分ける
- selectedPlan に沿った職種で統一する
- それぞれ少しずつ特徴を変える
- 最後は必ず次アクションで締める

出力形式：

ありがとうございます。${selectedPlan}案を前提に、具体求人イメージを3件出します。

【求人1】
職種：
業界：
会社タイプ：
想定年収：
勤務地 / 働き方：

【仕事内容】
- ・・・
- ・・・
- ・・・

【この人に合う理由】
- ・・・
- ・・・
- ・・・

【受かるために強調したいこと】
- ・・・
- ・・・
- ・・・

【懸念点】
- ・・・
- ・・・

【求人2】
職種：
業界：
会社タイプ：
想定年収：
勤務地 / 働き方：

【仕事内容】
- ・・・
- ・・・
- ・・・

【この人に合う理由】
- ・・・
- ・・・
- ・・・

【受かるために強調したいこと】
- ・・・
- ・・・
- ・・・

【懸念点】
- ・・・
- ・・・

【求人3】
職種：
業界：
会社タイプ：
想定年収：
勤務地 / 働き方：

【仕事内容】
- ・・・
- ・・・
- ・・・

【この人に合う理由】
- ・・・
- ・・・
- ・・・

【受かるために強調したいこと】
- ・・・
- ・・・
- ・・・

【懸念点】
- ・・・
- ・・・

【おすすめ応募順】
1位：
2位：
3位：

【次に進めます】
1. 求人1向けの職務経歴書を作る
2. 求人2向けの職務経歴書を作る
3. 求人3向けの職務経歴書を作る
4. 面接対策をする
5. 模擬面接を始める

補足前提：
- 今回の軸は ${planLabel}
- preferred_industries があれば最優先で反映
- desired_location があれば勤務地に反映
- minimum_salary があれば想定年収に反映
- office_attendance があれば働き方に反映
- avoid_points_in_current_job があれば求人設計に反映
- 未取得条件があっても、今ある情報だけで最大限具体化する
- 3件とも同じ内容にしない
- 「受かるために強調したいこと」は、事実ベースで言える範囲に限定する

現在のプロフィール:
${JSON.stringify(profile, null, 2)}
`;
}

function buildResumeInstruction(profile = {}, summary = "", selectedPlan = null) {
  const planGuide =
    selectedPlan === "A"
      ? "今回は A案を前提にしてください。ただし、A案の職種例をそのまま断定的に職歴へ転記しないでください。ユーザーが明示した事実からつながる表現に限定してください。"
      : selectedPlan === "B"
      ? "今回は B案を前提にしてください。ただし、B案の職種例をそのまま断定的に職歴へ転記しないでください。ユーザーが明示した事実からつながる表現に限定してください。"
      : selectedPlan === "C"
      ? "今回は C案を前提にしてください。ただし、C案の職種例をそのまま断定的に職歴へ転記しないでください。ユーザーが明示した事実からつながる表現に限定してください。"
      : "案が未確定なら、ユーザーが明示した事実だけで中立的に整理してください。";

  return `
今回は「職務経歴書・経験整理」として回答してください。

最重要ルール：
- profile と summary に明示的に存在する情報だけを使う
- 実際に今回または過去会話でユーザーが明示した内容だけを書く
- 求人提案で出した職種例を、そのままユーザーの経歴として書いてはいけない
- 営業経験、法人営業、売上125%、既存顧客対応、顧客提案などは、ユーザーが明示していない限り絶対に書かない
- 会社名・役職・在籍期間・担当業務・実績のうち、不明なものは [要確認] と書く
- 推測で数値・資格・受賞歴・役職・担当顧客・KPI・プロジェクト成果を書かない
- 「〜と思われます」「〜と考えられます」でも、事実の創作はしない
- 書ける事実が少ない場合は、無理に埋めず簡潔に整理する

追加ルール：
- 一般論ではなく、ユーザー向けに具体的に書く
- そのまま職務経歴書に貼れる形にする
- LINEで読みやすくする
- 数値が不明な場合は「◯%」「◯件」ではなく、「改善に取り組んだ」「設備改善を担当した」など事実ベースで書く
- summary に古い情報があっても、今回の明示情報と矛盾するなら使わない
- 「システムエンジニア向けに寄せる」ことと「システムエンジニア経験があると書く」ことは別。後者は絶対にしない

案の前提：
${planGuide}

追加ルール（既知情報の反映）：
- profile や summary に会社名・在籍期間・実績がある場合は、[要確認] にせず反映する
- 既知情報として保持している内容（JFEスチールでの生産管理・業務改善、リクルートでの法人営業、売上125% など）は、profile / summary に存在する限り使ってよい
- selectedPlan が B の場合は、事業企画 / BizOps / BizDev 向けに、課題整理・関係者巻き込み・改善推進の再現性が伝わるように整理する
- ただし、存在しない経験（例：SQL、Salesforce、SaaS営業経験など）は断定しない
- [要確認] は、本当に profile / summary に存在しない項目だけに使う

出力形式：

【職務要約】
2〜4行
- 事実が少ない場合は短くてよい
- 不明な経歴を補完しない

【活かせる経験・強み】
- 事実ベースで2〜4点
- 不明なら書きすぎない

【職務経歴の書き方イメージ】
会社名：[要確認]
役職：[要確認]
期間：[要確認]

- 担当業務
- 実績・工夫
- 強調できる点

【この案向けに強調したいポイント】
- ユーザーの事実から言える範囲だけ
- 「〜に親和性がある」「〜へつながる可能性がある」のような表現は可
- ただし未経験事実を経験済みとして書かない

【次に教えてほしいこと】
- 本当に必要な確認事項だけ1〜3個

禁止事項：
- 推測の営業経験を書く
- 推測の売上実績を書く
- 推測の顧客対応経験を書く
- 求人提案の内容をそのまま職歴に変換する
- summary の曖昧情報を断定表現に変える
- 実際に話していない役職名を書く

現在のselectedPlan:
${selectedPlan || "未選択"}

現在のprofile:
${JSON.stringify(profile, null, 2)}

現在のsummary:
${summary}
`;
}

function buildResumeCompleteInstruction(
  profile = {},
  summary = "",
  selectedPlan = null
) {
  const planGuide =
    selectedPlan === "A"
      ? "営業企画 / カスタマーサクセス向け"
      : selectedPlan === "B"
      ? "事業企画 / 新規事業向け"
      : selectedPlan === "C"
      ? "営業企画 / マーケティング企画向け"
      : "営業企画 / カスタマーサクセス / 企画職向け";

  return `
今回は「職務経歴書完成版」として回答してください。

前提：
- ${planGuide}
- profile と summary に明示的に存在する情報だけを使う
- 実際にユーザーが話したことだけを使う
- 推測の数値・受賞歴・資格・手法・役職・新規開拓経験は絶対に書かない
- 存在しない情報を補完しない
- 不明な内容は [要確認] と書く
- 在籍期間・役職・成果数値が不明なら、20XX年のように埋めず、必ず [要確認] と書く
- そのまま職務経歴書にコピペできる形で書く
- LINEで読みやすく、見出し付きにする
- selectedPlan に合わせて内容を寄せる
- Aなら営業企画 / カスタマーサクセス寄り
- Bなら事業企画 / 新規事業寄り
- Cなら営業企画 / マーケティング企画寄り
- profile や summary にない業務内容は書かない

出力形式：

【職務要約】
3〜5行

【活かせる経験・強み】
- ・・・
- ・・・
- ・・・

【職務経歴】

会社名：
所属・役職：[要確認]
在籍期間：[要確認]

担当業務：
- ・・・
- ・・・
- ・・・

実績・工夫：
- ・・・
- ・・・
- ・・・

会社名：
所属・役職：[要確認]
在籍期間：[要確認]

担当業務：
- ・・・
- ・・・
- ・・・

実績・工夫：
- ・・・
- ・・・
- ・・・

【自己PR】
4〜8行

【不足していて確認したい項目】
- 在籍期間
- 実績の具体的な数値
- 担当顧客 / 担当業務の詳細
- その他、職務経歴書完成に必要な情報

【この案向けに追加で入れると良い内容】
- ・・・
- ・・・

現在のselectedPlan:
${selectedPlan || "未選択"}

現在のprofile:
${JSON.stringify(profile, null, 2)}

現在のsummary:
${summary}
`;
}

function buildInterviewInstruction(profile = {}, summary = "", selectedPlan = null) {
  const planGuide =
    selectedPlan === "A"
      ? "今回は A案（営業企画 / カスタマーサクセス寄り）を前提に面接対策をしてください。顧客理解、提案力、継続支援、関係構築を軸にしてください。"
      : selectedPlan === "B"
      ? "今回は B案（事業企画 / 新規事業開発寄り）を前提に面接対策をしてください。課題整理、推進力、部門横断連携、企画志向を軸にしてください。"
      : selectedPlan === "C"
      ? "今回は C案（マーケティング企画 / 営業企画寄り）を前提に面接対策をしてください。顧客理解、提案改善、数字の見方、企画への接続を軸にしてください。"
      : "まだ案が確定していない場合は、営業企画 / カスタマーサクセス / 企画職に広く通用する面接対策にしてください。";

  return `
今回は「面接対策」として回答してください。

ルール：
- 一般論ではなく、ユーザー向けに具体的に書く
- profile と summary を必ず使う
- 直前の求人提案・職務経歴書の流れを踏まえる
- 不明な事実は断定しない
- 推測で実績・資格・受賞歴を書かない
- LINEで読みやすくする
- 回答例はそのまま面接で使える自然な日本語にする
- 最後に、追加で確認したいことがあれば1〜2個だけ聞く

案の前提：
${planGuide}

出力形式：

【想定される質問】
- ・・・
- ・・・
- ・・・

【回答例】
Q. ・・・
A. ・・・

Q. ・・・
A. ・・・

【企業が懸念しそうな点】
- ・・・
- ・・・

【その返し方】
- ・・・
- ・・・

【逆質問】
- ・・・
- ・・・
- ・・・

【次に教えてほしいこと】
- ・・・
- ・・・

禁止事項：
- 推測の受賞歴を書かない
- 推測の資格・フレームワークを書かない
- 一般論の例文を混ぜない
- 実際に話した内容を優先する

現在のselectedPlan:
${selectedPlan || "未選択"}

現在のprofile:
${JSON.stringify(profile, null, 2)}

現在のsummary:
${summary}
`;
}

function isValidJobSuggestionFormat(text = "") {
  const s = String(text || "");
  return (
    s.includes("【A. 安定寄り】") &&
    s.includes("【B. 成長寄り】") &&
    s.includes("【C. バランス寄り】") &&
    s.includes("一致度：") &&
    s.includes("応募優先度：") &&
    s.includes("一致理由") &&
    s.includes("応募優先度の理由") &&
    s.includes("懸念点") &&
    s.includes("【おすすめ応募順】")
  );
}

function cleanJobSuggestionLead(text = "") {
  let s = String(text || "").trim();

  const unwantedLeads = [
    /^失礼いたしました！?\s*/u,
    /^申し訳ありませんが、?\s*/u,
    /^以下の形式で再度求人提案をさせていただきます。?\s*/u,
    /^再度求人提案します。?\s*/u,
    /^改めて求人提案します。?\s*/u,
    /^それでは、?再度ご提案します。?\s*/u,
  ];

  for (const pattern of unwantedLeads) {
    s = s.replace(pattern, "").trim();
  }

  const allowedLead =
    "ありがとうございます！あなたの希望条件に基づいて、以下の求人提案を考えてみました。";

  const startIndex = s.indexOf("【A. 安定寄り】");

  if (startIndex >= 0) {
    return `${allowedLead}\n\n${s.slice(startIndex).trim()}`;
  }

  return s;
}

// ===== Safe JSON Helpers =====
function stripCodeFences(text = "") {
  return String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractFirstJsonObject(text = "") {
  const s = String(text || "");
  const start = s.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") depth++;
    if (ch === "}") depth--;

    if (depth === 0) {
      return s.slice(start, i + 1);
    }
  }

  return null;
}

function sanitizeProfilePatch(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const allowedKeys = new Set([
    "experience_keywords",
    "interest_keywords",
    "desired_salary_man",
    "work_style_note",
    "ng_note",
    "strength_note",
    "reason_note",
    "change_timing",
    "desired_location",
    "minimum_salary",
    "office_attendance",
    "preferred_industries",
    "avoid_points_in_current_job",
  ]);

  const cleaned = {};

  for (const [key, value] of Object.entries(raw)) {
    if (!allowedKeys.has(key)) continue;

    if (
      key === "experience_keywords" ||
      key === "interest_keywords" ||
      key === "preferred_industries" ||
      key === "avoid_points_in_current_job"
    ) {
      if (Array.isArray(value)) {
        const arr = value
          .map((v) => String(v || "").trim())
          .filter(Boolean)
          .slice(0, 10);
        if (arr.length > 0) cleaned[key] = arr;
      } else {
        const str = String(value || "").trim();
        if (str) cleaned[key] = [str.slice(0, 200)];
      }
      continue;
    }

    if (key === "desired_salary_man") {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) {
        cleaned[key] = Math.round(n);
      }
      continue;
    }

    if (key === "change_timing") {
      const normalized = String(value || "").trim().toLowerCase();
      if (["high", "medium", "low"].includes(normalized)) {
        cleaned[key] = normalized;
      }
      continue;
    }

    const str = String(value || "").trim();
    if (str) {
      cleaned[key] = str.slice(0, 500);
    }
  }

  return cleaned;
}

function safeParseProfilePatch(content = "") {
  const candidates = [
    String(content || "").trim(),
    stripCodeFences(content),
    extractFirstJsonObject(content),
    extractFirstJsonObject(stripCodeFences(content)),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      return sanitizeProfilePatch(parsed);
    } catch (e) {
      // continue
    }
  }

  return {};
}

// ===== Summary Helpers =====
function sanitizeSummary(text = "") {
  return String(text || "")
    .replace(/^```[\s\S]*?```$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

async function generateUserSummary(profile = {}, existingSummary = "", userMessage = "") {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `
あなたはキャリアアドバイザーのための要約AIです。
ユーザーの転職プロフィール要約を、短く自然な日本語で1〜3文にまとめてください。

ルール：
- 日本語のみ
- 1〜3文
- 事実ベース
- 推測しない
- 未確定な内容は「〜意向」「〜希望」「〜可能性がある」など柔らかく表現
- 年収、職種志向、働き方、転職温度感、強み・懸念があれば優先
- 冗長にしない
- 400文字以内
`,
        },
        {
          role: "user",
          content: `既存summary:
${existingSummary || "なし"}

現在profile:
${JSON.stringify(profile, null, 2)}

今回の発話:
${userMessage}`,
        },
      ],
    });

    const text = response.choices?.[0]?.message?.content || "";
    return sanitizeSummary(text);
  } catch (error) {
    console.error("generateUserSummary error:", error.response?.data || error.message);
    return sanitizeSummary(existingSummary || "");
  }
}

// ===== AI Profile Extraction =====
async function extractProfilePatchWithAI(userMessage) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `
あなたはキャリアアドバイザー向けの情報抽出AIです。
ユーザーの発話から、転職プロフィールとして保存すべき情報だけをJSONで抽出してください。

出力ルール：
- 必ずJSONオブジェクトのみを返す
- コードブロックは使わない
- 情報がない項目は出さない
- 推測しない
- 配列は文字列配列
- 年収は「万円」の整数で返す
- 日本語で返す

使ってよいキー：
experience_keywords
interest_keywords
desired_salary_man
work_style_note
ng_note
strength_note
reason_note
change_timing
desired_location
minimum_salary
office_attendance
preferred_industries
avoid_points_in_current_job

補足：
- preferred_industries は配列
- avoid_points_in_current_job は配列
- minimum_salary はユーザー表現のままでよい
- desired_location は勤務地希望
- office_attendance は出社頻度
- 現職の不満や避けたい働き方は avoid_points_in_current_job に入れる

change_timing は "high" / "medium" / "low" のいずれか
`,
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    const content = response.choices?.[0]?.message?.content || "{}";
    const parsed = safeParseProfilePatch(content);

    if (!parsed || Object.keys(parsed).length === 0) {
      console.warn("Profile patch parse failed. raw content:", content);
      return {};
    }

    return parsed;
  } catch (error) {
    console.error(
      "extractProfilePatchWithAI error:",
      error.response?.data || error.message
    );
    return {};
  }
}

async function updateUserProfile(userId, userMessage) {
  const existing = await getSession(userId);
  const existingProfile = normalizeProfile(existing?.profile || {});
  const existingSummary = existing?.summary || "";

  const newPatch = await extractProfilePatchWithAI(userMessage);

  let mergedProfile = existingProfile;

  if (newPatch && Object.keys(newPatch).length > 0) {
    mergedProfile = mergeProfile(existingProfile, newPatch);
  }

  const nextSummary = await generateUserSummary(
    mergedProfile,
    existingSummary,
    userMessage
  );

  const updatedSession = await upsertSession(userId, {
    profile: mergedProfile,
    summary: nextSummary || existingSummary || null,
  });

  return updatedSession || {
    profile: mergedProfile,
    summary: nextSummary || existingSummary || "",
    interview_state: existing?.interview_state || {},
    current_topic: existing?.current_topic || null,
    current_mode: existing?.current_mode || "normal",
    is_paused: existing?.is_paused || false,
    paused_state: existing?.paused_state || {},
    company_templates: existing?.company_templates || {},
  };
}

// ===== System Prompt =====
const SYSTEM_PROMPT = `
あなたは優秀なキャリアアドバイザーです。
ユーザーに対して、自然で親しみやすく、でも実務的に役立つ回答をしてください。

対応できること：
- 自己分析
- 求人提案
- 職務経歴書・経験整理
- 職務経歴書完成版
- 面接対策
- キャリア相談
- 模擬面接の前後フォロー
- 回答添削

共通ルール：
- 会話の途中でテーマが変わっても自然に対応する
- ユーザーが迷っていそうなら、今できることを短く案内する
- 「求人検索」ではなく「求人提案」という表現を使う
- 回答はLINEで読みやすい長さと改行を意識する
- 上から目線にならない
- 不明点は決めつけず、確認ベースで伝える
- できるだけ次の一歩が明確になるように返す
- 保存済みプロフィールは自然に活かすが、未確定情報として扱う
- 求人提案では、保存済みの希望勤務地・年収下限・出社頻度・業界希望・避けたいことがあれば優先して反映する
`;

// ===== OpenAI Ask =====
async function askOpenAI(userId, userMessage, forcedTopic = null, overrideInstruction = "") {
  try {
    const history = await getRecentMessages(userId, 12);
    const session = await getSession(userId);
    const profile = normalizeProfile(session?.profile || {});
    const summary = session?.summary || "";
    const currentTopic = forcedTopic || session?.current_topic || null;

    const isJobSuggestionMode =
      isJobSuggestionContext(userMessage) || currentTopic === "job_suggestion";

    const isResumeMode = currentTopic === "resume";
    const isResumeCompleteMode = currentTopic === "resume_complete";
    const isInterviewMode = currentTopic === "interview";

    const sessionInterviewState = normalizeInterviewState(session?.interview_state || {});
    const selectedPlan =
      sessionInterviewState.selectedPlan || sessionInterviewState.lastSelectedPlan || null;

    const isFollowup =
      currentTopic === "job_suggestion" && isFollowupRequest(userMessage);

  const wantsConcreteThreeJobs = isConcreteThreeJobsRequest(userMessage);

const extraInstructions =
  overrideInstruction ||
  (isJobSuggestionMode && wantsConcreteThreeJobs
    ? buildConcreteThreeJobsInstruction(profile, selectedPlan || "A", summary)
    : isJobSuggestionMode && isFollowup
    ? buildJobSuggestionFollowupInstruction(profile, selectedPlan || "A")
    : isJobSuggestionMode
　　 ? buildJobSuggestionInstruction(profile, summary)
    : isResumeCompleteMode
    ? buildResumeCompleteInstruction(profile, summary, selectedPlan)
    : isResumeMode
    ? buildResumeInstruction(profile, summary, selectedPlan)
    : isInterviewMode
    ? buildInterviewInstruction(profile, summary, selectedPlan)
    : "");

    const messages = [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "system",
        content: `
このユーザーの現在プロフィールです。
求人提案では必ずこの内容を優先して反映してください。

profile:
${JSON.stringify(profile, null, 2)}

特に以下は最優先です：
- preferred_industries
- desired_location
- minimum_salary
- office_attendance
- avoid_points_in_current_job

未確定情報は断定せず、確認ベースで扱ってください。
`,
      },
      {
        role: "system",
        content:
          "このユーザーの現在summaryです。自然に参考にしてください。古そう・不確実そうなら確認しながら使ってください。\n" +
          summary,
      },
      ...(currentTopic
        ? [
            {
              role: "system",
              content: `現在の会話テーマは「${currentTopic}」です。短い継続メッセージ（例: お願いします、次、続けて）はこのテーマの続きとして扱ってください。`,
            },
          ]
        : []),
      ...(extraInstructions
        ? [{ role: "system", content: extraInstructions }]
        : []),
      ...history.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      { role: "user", content: userMessage },
    ];

    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
    });

    let reply =
      response.choices?.[0]?.message?.content || "うまく回答を作れませんでした。";

    if (
      isJobSuggestionMode &&
      !overrideInstruction &&
      !isFollowup &&
      !isValidJobSuggestionFormat(reply)
    ) {
      const retryMessages = [
        ...messages,
        {
          role: "assistant",
          content: reply,
        },
        {
          role: "user",
          content:
            "出力形式が不足しています。謝罪文・言い訳・「再度」などの前置きは書かず、自然な導入文は「ありがとうございます！あなたの希望条件に基づいて、以下の求人提案を考えてみました。」のみ許可します。必ずA/B/Cの3案すべてに「一致度」「応募優先度」「一致理由」「応募優先度の理由」「懸念点」を入れ、最後に【おすすめ応募順】を付けて完全な形式で再出力してください。",
        },
      ];

      const retryResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: retryMessages,
        temperature: 0.2,
      });

      const retried = retryResponse.choices?.[0]?.message?.content || reply;

      if (isValidJobSuggestionFormat(retried)) {
        reply = retried;
      }
    }

    if (isJobSuggestionMode && !overrideInstruction && !isFollowup) {
      reply = cleanJobSuggestionLead(reply);
    }

    return reply;
  } catch (error) {
    console.error("OpenAI error:", error.response?.data || error.message);
    return "すみません、今ちょっと調子が悪いです。もう一度送ってください。";
  }
}

async function generateAutoRefinedJobSuggestion(userId) {
  const autoPrompt =
    "保存済みの条件がそろったので、現在のプロフィールを前提に改めて求人提案してください。A/B/Cの3パターンで、より条件に沿って具体的に提案してください。未取得項目がなければ【次に確認したいこと】は出さないでください。各案に一致度と応募優先度を必ずつけてください。";

  return await askOpenAI(userId, autoPrompt, "job_suggestion");
}

// ===== Topic Starter Replies =====
function getStarterReplyByIntent(intent) {
  switch (intent) {
    case "self_analysis":
      return "自己分析ですね。これまでの経験・得意なこと・やりたくないことを、わかる範囲で教えてください。";

    case "job_suggestion":
      return `求人提案ですね。わかる範囲で大丈夫なので、以下を教えてください。

・今までの経験（例：法人営業3年、製造業、RAなど）
・やりたい仕事（例：営業企画、SaaS、企画寄り）
・避けたいこと（例：転勤、ノルマ強すぎ、詰め文化）
・希望年収
・勤務地 / 働き方

例：
営業経験を活かしつつ、企画寄りの仕事をしたいです。
年収は600万円以上、東京希望です。
詰め管理が強い環境は避けたいです。

ざっくりでも大丈夫です。近いものを選ぶだけでも進められます。

1. 営業経験を活かして安定寄りに進みたい
2. 企画・事業寄りにキャリアアップしたい
3. SaaSや成長企業で挑戦したい`;

    case "resume":
      return "職務経歴書・経験整理ですね。これまでの職歴、担当業務、実績をわかる範囲で送ってください。";

    case "resume_complete":
      return "職務経歴書完成版ですね。これまでの会話内容をもとに、そのまま提出しやすい形でまとめます。";

    case "interview":
      return "面接対策ですね。受ける職種や企業、想定される質問があれば送ってください。";

    case "mock_interview":
      return "模擬面接モードですね。例：模擬面接 営業企画 厳しめ / 模擬面接 RA 厳しめ / 模擬面接 リクルート RA 厳しめ / 模擬面接 SaaS 営業企画 厳しめ のように送ると、テンプレ別で進められます。";

    case "career":
      return "キャリア相談ですね。今の悩み、転職したい理由、迷っていることをそのまま送ってください。";

    default:
      return getMainMenuText();
  }
}

function getSelectedPlanFromState(state = {}) {
  const normalized = normalizeInterviewState(state);
  return normalized.selectedPlan || normalized.lastSelectedPlan || null;
}

function normalizeSessionStage(stage = null) {
  const allowed = [
    "intake",
    "self_analysis",
    "job_suggestion",
    "hypothesis_selection",
    "job_shortlist",
    "resume",
    "resume_complete",
    "interview",
    "mock_interview",
    "selection_tracking",
    "career",
  ];

  return allowed.includes(stage) ? stage : null;
}

function deriveStageFromTopic(topic = null) {
  switch (topic) {
    case "self_analysis":
      return "self_analysis";
    case "job_suggestion":
      return "job_suggestion";
    case "resume":
      return "resume";
    case "resume_complete":
      return "resume_complete";
    case "interview":
      return "interview";
    case "mock_interview":
      return "mock_interview";
    case "career":
      return "career";
    default:
      return "intake";
  }
}

function normalizeUuidLike(value) {
  if (!value) return null;
  const s = String(value).trim();
  return s || null;
}

function buildSessionStatePatch(patch = {}, current = {}) {
  const resolvedTopic =
    patch.current_topic !== undefined
      ? patch.current_topic
      : current?.current_topic || null;

  const resolvedStage =
    patch.current_stage !== undefined
      ? normalizeSessionStage(patch.current_stage)
      : normalizeSessionStage(current?.current_stage) ||
        deriveStageFromTopic(resolvedTopic);

  return {
    current_topic: resolvedTopic,
    current_stage: resolvedStage,
    current_hypothesis_id:
      patch.current_hypothesis_id !== undefined
        ? normalizeUuidLike(patch.current_hypothesis_id)
        : normalizeUuidLike(current?.current_hypothesis_id),
    current_job_id:
      patch.current_job_id !== undefined
        ? normalizeUuidLike(patch.current_job_id)
        : normalizeUuidLike(current?.current_job_id),
    active_search_id:
      patch.active_search_id !== undefined
        ? normalizeUuidLike(patch.active_search_id)
        : normalizeUuidLike(current?.active_search_id),
  };
}

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  try {
    const signature = req.headers["x-line-signature"];

    if (!validateLineSignature(req.rawBody, signature)) {
      console.error("Invalid LINE signature");
      return res.status(401).send("Invalid signature");
    }

    const events = req.body.events || [];

    for (const event of events) {
      try {
        if (event.type !== "message" || event.message.type !== "text") continue;

        const userId = event.source.userId;
        const replyToken = event.replyToken;
        const userMessage = (event.message.text || "").trim();

        if (event.source?.type === "user" && userId) {
          await showLineLoading(userId, 10);
        }

        console.log("User message:", userMessage);

        const sessionBefore = await getSession(userId);
        const beforeInterviewState = normalizeInterviewState(
          sessionBefore?.interview_state || {}
        );

        // ===== 一時停止 / 再開 =====
        if (isPauseCommand(userMessage)) {
          await saveMessage(userId, "user", userMessage);
          await handlePauseMockInterview(userId, replyToken, sessionBefore);
          continue;
        }

        if (isResumeCommand(userMessage)) {
          await saveMessage(userId, "user", userMessage);
          const latestSession = await getSession(userId);
          await handleResumeMockInterview(userId, replyToken, latestSession);
          continue;
        }

        if (sessionBefore?.is_paused) {
          await saveMessage(userId, "user", userMessage);
          const reply =
            "今は模擬面接を一時停止中です。再開する場合は「再開」、終了する場合は「終了」と送ってください。";
          await saveMessage(userId, "assistant", reply);
          await replyToLine(replyToken, reply);
          continue;
        }

        // ===== 企業テンプレ追加 / 一覧 / 読み込み / 削除 =====
        if (isCompanyTemplateAddCommand(userMessage)) {
          await saveMessage(userId, "user", userMessage);
          await handleCompanyTemplateAddStart(userId, replyToken, sessionBefore);
          continue;
        }

        if (isCompanyTemplateListCommand(userMessage)) {
          await saveMessage(userId, "user", userMessage);
          await handleCompanyTemplateList(userId, replyToken, sessionBefore);
          continue;
        }

        if (isCompanyTemplateDeleteCommand(userMessage)) {
          await saveMessage(userId, "user", userMessage);
          await handleCompanyTemplateDeleteStart(userId, replyToken, sessionBefore);
          continue;
        }

        if (
          sessionBefore?.profile?.waiting_company_template_input &&
          userMessage.includes("企業名:")
        ) {
          await saveMessage(userId, "user", userMessage);
          const latestSession = await getSession(userId);
          await handleCompanyTemplateInput(
            userId,
            replyToken,
            latestSession,
            userMessage
          );
          continue;
        }

        if (
          sessionBefore?.profile?.waiting_company_template_delete &&
          userMessage.startsWith("削除:")
        ) {
          await saveMessage(userId, "user", userMessage);
          const latestSession = await getSession(userId);
          await handleCompanyTemplateDeleteExecute(
            userId,
            replyToken,
            latestSession,
            userMessage
          );
          continue;
        }

        const templateTarget = extractTemplateUseTarget(userMessage);
        if (templateTarget) {
          await saveMessage(userId, "user", userMessage);
          const latestSession = await getSession(userId);
          await handleCompanyTemplateSelect(
            userId,
            replyToken,
            latestSession,
            templateTarget
          );
          continue;
        }

        // ===== 模擬面接開始 =====
      if (detectMockInterviewCommand(userMessage)) {
  const requestedLabel = detectRequestedSuggestionLabel(userMessage);
  const latestSession = await getSession(userId);
  const latestState = normalizeInterviewState(latestSession?.interview_state || {});

  if (requestedLabel) {
    await upsertSession(userId, {
      interview_state: {
        ...latestState,
        selectedPlan: requestedLabel,
        lastSelectedPlan: requestedLabel,
      },
    });
  }

  const refreshedSession = await getSession(userId);
  await startMockInterview(userId, replyToken, refreshedSession, userMessage);
  continue;
}

        // ===== 模擬面接中の回答処理 =====
        if (
          beforeInterviewState.mode === "mock_interview" &&
          !beforeInterviewState.isFinished &&
          !detectMockInterviewCommand(userMessage)
        ) {
          await saveMessage(userId, "user", userMessage);
          const latestSession = await getSession(userId);
          await handleMockInterviewAnswer(userId, replyToken, latestSession, userMessage);
          continue;
        }

　　　　　const resolvedTopic = resolveCurrentTopic(
  　　　　　userMessage,
  　　　　　sessionBefore?.current_topic || null
　　　　　);

　　　　　const resolvedStage =
  　　　　　normalizeSessionStage(sessionBefore?.current_stage) ||
  　　　　　deriveStageFromTopic(resolvedTopic);

　　　　　if (
  　　　　　resolvedTopic !== (sessionBefore?.current_topic || null) ||
  　　　　　resolvedStage !== (sessionBefore?.current_stage || null)
　　　　　) {
  　　　　　await upsertSession(userId, {
    　　　　　current_topic: resolvedTopic,
    　　　　　current_stage: deriveStageFromTopic(resolvedTopic),
  　　　　　});
　　　　　}

        await saveMessage(userId, "user", userMessage);
        const updatedSession = await updateUserProfile(userId, userMessage);
        const updatedProfile = normalizeProfile(updatedSession?.profile || {});
        const currentState = normalizeInterviewState(
          (await getSession(userId))?.interview_state || beforeInterviewState
        );

        const menuIntent = detectMenuIntent(userMessage);
       const selectedJob = detectSelectedJob(userMessage);

if (selectedJob) {
  await upsertSession(userId, {
    selected_job: selectedJob,
    interview_state: {
      ...currentState,
      lastOutputType: "job_select",
    },
  });
}
        if (menuIntent === "show_menu") {
          const reply = getMainMenuText();
          await saveMessage(userId, "assistant", reply);
          await replyToLine(replyToken, reply);
          continue;
        }

        // ===== 前回の模擬面接 振り返り =====
        if (detectMockInterviewReviewCommand(userMessage)) {
          await handleMockInterviewReview(userId, replyToken, userMessage);
          continue;
        }

        // ===== 回答添削 =====
        if (detectAnswerPolishCommand(userMessage)) {
          await handleAnswerPolish(userId, replyToken, userMessage);
          continue;
        }

        // ===== A/B/C を選んだら、その案を保存 =====
        const selectedLabel = detectRequestedSuggestionLabel(userMessage);
        if (selectedLabel) {
          await upsertSession(userId, {
            interview_state: {
              ...currentState,
              selectedPlan: selectedLabel,
              lastSelectedPlan: selectedLabel,
              lastOutputType: "job_suggestion_select",
            },
          });
        }

        // ===== A/B/C 選択後は、経験整理も即その案前提で返す =====
        if (menuIntent === "resume" && selectedPlan) {
          await upsertSession(userId, {
            current_topic: "resume",
            interview_state: {
              ...currentState,
              selectedPlan,
              lastSelectedPlan: selectedPlan,
              lastOutputType: "resume",
            },
          });

          const reply = await askOpenAI(userId, userMessage, "resume");

          await saveMessage(userId, "assistant", reply);
          await replyToLine(replyToken, reply);
          continue;
        }

        // ===== A/B/C 選択後は、完成版も即その案前提で返す =====
        if (menuIntent === "resume_complete" && selectedPlan) {
          await upsertSession(userId, {
            current_topic: "resume_complete",
            interview_state: {
              ...currentState,
              selectedPlan,
              lastSelectedPlan: selectedPlan,
              lastOutputType: "resume_complete",
            },
          });

          const reply = await askOpenAI(userId, userMessage, "resume_complete");

          await saveMessage(userId, "assistant", reply);
          await replyToLine(replyToken, reply);
          continue;
        }

        // ===== A/B/C 選択後は、面接対策を即その案前提で返す =====
  if (menuIntent === "interview") {
  const currentState = normalizeInterviewState(
    updatedSession?.interview_state || sessionBefore?.interview_state || {}
  );

  const selectedPlan =
    currentState.selectedPlan ||
    currentState.lastSelectedPlan ||
    "A";

  await upsertSession(userId, {
    current_topic: "interview",
    current_stage: "interview",
    interview_state: {
      ...currentState,
      selectedPlan,
      lastSelectedPlan: selectedPlan,
      lastOutputType: "interview",
    },
  });

  const reply = await askOpenAI(userId, userMessage, "interview");
  await saveMessage(userId, "assistant", reply);
  await replyToLine(replyToken, reply);
  continue;
}

        // ===== 面接対策に入った後で「A案/B案/C案」だけ送っても切り替えられるようにする =====
        if (menuIntent === "interview" || resolvedTopic === "interview") {
          const planOnly = detectRequestedSuggestionLabel(userMessage);
          if (planOnly) {
            await upsertSession(userId, {
  current_topic: "interview",
  current_stage: "interview",
  interview_state: {
    ...currentState,
    selectedPlan: planOnly,
    lastSelectedPlan: planOnly,
    lastOutputType: "interview",
  },
});

            const reply = await askOpenAI(userId, userMessage, "interview");
            await saveMessage(userId, "assistant", reply);
            await replyToLine(replyToken, reply);
            continue;
          }
        }

        // ===== starter reply は selectedPlan がない時だけ =====
        if (
          (menuIntent === "self_analysis" ||
            menuIntent === "job_suggestion" ||
            menuIntent === "resume" ||
            menuIntent === "resume_complete" ||
            menuIntent === "interview" ||
            menuIntent === "career") &&
          shouldUseStarterReply(userMessage, menuIntent)
        ) {
          const topicToSave = menuIntent;

          await upsertSession(userId, {
            current_topic: topicToSave,
            interview_state: {
              ...currentState,
            },
          });

          const reply = getStarterReplyByIntent(menuIntent);

          await saveMessage(userId, "assistant", reply);
          await replyToLine(replyToken, reply);
          continue;
        }

        const waitingPreferenceKey = currentState.last_asked_preference;
        const activeTopic = resolvedTopic || updatedSession?.current_topic || null;

        // ===== 不足条件ヒアリング =====
        if (
          activeTopic === "job_suggestion" &&
          waitingPreferenceKey &&
          isFieldFilled(updatedProfile[waitingPreferenceKey]) &&
          isLikelySimplePreferenceAnswer(userMessage)
        ) {
          const nextQuestion = getNextMissingPreferenceQuestion(updatedProfile);

          if (nextQuestion) {
            const reply = `ありがとうございます。
では次に、こちらを教えてください。

${nextQuestion.question}`;

            await upsertSession(userId, {
              current_topic: "job_suggestion",
              interview_state: {
                ...currentState,
                pending_preference_questions: nextQuestion.remainingKeys,
                last_asked_preference: nextQuestion.key,
                lastOutputType: "job_suggestion_preference_question",
              },
            });

            await saveMessage(userId, "assistant", reply);
            await replyToLine(replyToken, reply);
            continue;
          } else {
            const reply = await generateAutoRefinedJobSuggestion(userId);

            await upsertSession(userId, {
              current_topic: "job_suggestion",
              interview_state: {
                ...currentState,
                pending_preference_questions: [],
                last_asked_preference: null,
                lastOutputType: "job_suggestion_main",
              },
            });

            await saveMessage(userId, "assistant", reply);
            await replyToLine(replyToken, reply);
            continue;
          }
        }

               // ===== 求人提案の深掘り =====
        if (activeTopic === "job_suggestion") {
          const explicitLabel = detectRequestedSuggestionLabel(userMessage);

          if (
            explicitLabel ||
            isNextRequest(userMessage) ||
            isFollowupRequest(userMessage)
          ) {
            const interviewState = normalizeInterviewState(currentState);
            const currentStep =
              typeof interviewState.jobSuggestionStep === "number"
                ? interviewState.jobSuggestionStep
                : explicitLabel
                ? ["A", "B", "C"].indexOf(explicitLabel)
                : -1;

            let targetStep = 0;

            if (explicitLabel) {
              targetStep = ["A", "B", "C"].indexOf(explicitLabel);
            } else if (isNextRequest(userMessage)) {
              if (currentStep >= 2) {
                const reply = `3つの案を一通り見たので、次は以下に進められます。

・職務経歴書
・職務経歴書完成版
・面接対策
・模擬面接

「職務経歴書」「職務経歴書完成版」「面接対策」または「模擬面接」と送ってください。`;

                await saveMessage(userId, "assistant", reply);
                await replyToLine(replyToken, reply);
                continue;
              }

              targetStep = currentStep + 1;
            } else {
              targetStep = currentStep >= 0 ? currentStep : 0;
            }

            const label = ["A", "B", "C"][targetStep];

            await upsertSession(userId, {
              current_topic: "job_suggestion",
              interview_state: {
                ...interviewState,
                jobSuggestionStep: targetStep,
                selectedPlan: label,
                lastSelectedPlan: label,
                lastOutputType: "job_suggestion_followup",
              },
            });

            const overrideInstruction = buildJobSuggestionFollowupInstruction(
              updatedProfile,
              label
            );

            const reply = await askOpenAI(
              userId,
              userMessage,
              "job_suggestion",
              overrideInstruction
            );

            await saveMessage(userId, "assistant", reply);
            await replyToLine(replyToken, reply);
            continue;
          }
        }

        // ===== 求人別 職務経歴書 =====
if (isSpecificJobResumeRequest(userMessage)) {
  const currentStateForResume = normalizeInterviewState(
    updatedSession?.interview_state || session?.interview_state || {}
  );

  const selectedPlan =
    currentStateForResume.selectedPlan ||
    currentStateForResume.lastSelectedPlan ||
    "A";

  let selectedJob = "求人1";

  if (userMessage.includes("求人2")) {
    selectedJob = "求人2";
  } else if (userMessage.includes("求人3")) {
    selectedJob = "求人3";
  }

  const detectedSelectedJob = detectSelectedJob(userMessage);

await upsertSession(userId, {
  current_topic: "resume",
  current_stage: "resume",
  selected_job:
    detectedSelectedJob || updatedSession?.selected_job || null,
  interview_state: {
    ...currentStateForResume,
    selectedPlan,
    lastSelectedPlan: selectedPlan,
    selectedJob:
      detectedSelectedJob || updatedSession?.selected_job || null,
    lastOutputType: "resume_specific_job",
  },
});


  const reply = await askOpenAI(
    userId,
    userMessage,
    "resume",
    `
今回は特定求人向けの職務経歴書作成です。

対象:
- selectedPlan: ${selectedPlan}
- selectedJob: ${detectedSelectedJob}

以下の求人向けに、職務経歴書を作成してください。

重要:
- ${detectedSelectedJob} の内容だけを前提にする
- 他の求人の内容を混ぜない
- profile / summary にある事実だけを使う
- 実際に話していない経験や成果を追加しない
- その求人で評価される経験を、事実ベースで強調する
- LINEで読みやすく、見出し付きにする

出力形式:

【職務要約】
2〜4行

【活かせる経験】
- ・・・
- ・・・
- ・・・

【${detectedSelectedJob}向けに強調したい実績】
- ・・・
- ・・・
- ・・・

【職務経歴書にそのまま入れる文章】
職務要約
- ・・・

職務経歴
1）
- ・・・

2）
- ・・・

強み・スキル
- ・・・

不足情報があれば最後に
「不足している情報」
として1〜3個だけ書く。
`
  );

  await saveMessage(userId, "assistant", reply);
  await replyToLine(replyToken, reply);
  continue;
}

        // ===== 具体求人3件 =====
        if (isConcreteThreeJobsRequest(userMessage)) {
          const currentStateForJobs = normalizeInterviewState(
            updatedSession?.interview_state || session?.interview_state || {}
          );

          const selectedPlan =
            currentStateForJobs.selectedPlan ||
            currentStateForJobs.lastSelectedPlan ||
            "A";

          await upsertSession(userId, {
  current_topic: "job_suggestion",
  current_stage: "job_shortlist",
  interview_state: {
    ...currentStateForJobs,
    selectedPlan,
    lastSelectedPlan: selectedPlan,
    lastOutputType: "job_suggestion_concrete_3",
  },
});

          const reply = await askOpenAI(
            userId,
            userMessage,
            "job_suggestion",
            buildConcreteThreeJobsInstruction(updatedProfile, selectedPlan)
          );

          await saveMessage(userId, "assistant", reply);
          await replyToLine(replyToken, reply);
          continue;
        }

        // ===== 通常応答 =====
        const assistantReply = await askOpenAI(userId, userMessage, activeTopic);

        let finalReply = assistantReply;
        const finishedTopic = detectFinishedTopic(userMessage);
        const isFollowup =
          activeTopic === "job_suggestion" && isFollowupRequest(userMessage);

        if (
  !isFollowup &&
  (activeTopic === "job_suggestion" ||
    shouldAskMissingPreferences(assistantReply, activeTopic))
) {
  const singleQuestion = buildSingleMissingQuestionMessage(updatedProfile);
  const nextQuestion = getNextMissingPreferenceQuestion(updatedProfile);

  if (singleQuestion && nextQuestion) {
    finalReply += singleQuestion;

    await upsertSession(userId, {
      current_topic: "job_suggestion",
      current_stage: "job_suggestion",
      interview_state: {
        ...currentState,
        pending_preference_questions: nextQuestion.remainingKeys,
        last_asked_preference: nextQuestion.key,
        lastOutputType: "job_suggestion_preference_question",
      },
    });
  } else if (activeTopic === "job_suggestion") {
    await upsertSession(userId, {
      current_topic: "job_suggestion",
      current_stage: "job_suggestion",
      interview_state: {
        ...currentState,
        pending_preference_questions: [],
        last_asked_preference: null,
        lastOutputType: "job_suggestion_main",
      },
    });
  }
}
        const shouldSkipTopicMenu =
          activeTopic === "job_suggestion" ||
          isJobSuggestionContext(userMessage) ||
          shouldAskMissingPreferences(assistantReply, activeTopic);

        if (!shouldSkipTopicMenu && finishedTopic) {
          finalReply += `\n\n---\n${getNextActionMenuByTopic(finishedTopic)}`;
        } else if (!shouldSkipTopicMenu && shouldAppendMenu(userMessage, assistantReply)) {
          finalReply += `\n\n---\n${getMainMenuText()}`;
        }

                await saveMessage(userId, "assistant", finalReply);
        await replyToLine(replyToken, finalReply);
      } catch (eventError) {
        console.error("Event handling error:", eventError);
      }
    }

    return res.status(200).send("OK");
  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(500).send("Internal Server Error");
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});