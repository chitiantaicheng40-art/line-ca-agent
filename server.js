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

// ===== Menu Text =====
function getMainMenuText() {
  return `途中で話を変えても大丈夫です。

今できること👇
① 自己分析
② 求人提案
③ 職務経歴書・経験整理
④ 面接対策
⑤ キャリア相談

やりたいものをそのまま送ってください。
例：自己分析、求人提案、面接対策`;
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

やりたいものをそのまま送ってください。`;

    case "job_suggestion":
      return `求人提案の次は、こんな進め方ができます👇
① 気になる求人の深掘り
② 職務経歴書・経験整理
③ 面接対策
④ キャリア相談

やりたいものをそのまま送ってください。`;

    case "resume":
      return `職務経歴書・経験整理の次は、こちらもできます👇
① 求人提案
② 面接対策
③ キャリア相談

やりたいものをそのまま送ってください。`;

    case "interview":
      return `面接対策の次は、こちらも進められます👇
① 求人提案
② 職務経歴書・経験整理
③ キャリア相談

やりたいものをそのまま送ってください。`;

    case "career":
      return `キャリア相談の次は、こちらもできます👇
① 自己分析
② 求人提案
③ 職務経歴書・経験整理
④ 面接対策

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
    t === "経験整理" ||
    t === "経歴整理"
  ) {
    return "resume";
  }

  if (t === "4" || t === "面接対策") return "interview";
  if (t === "5" || t === "キャリア相談") return "career";

  return null;
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
    "IT",
  ];

  if (t.length >= 20) return false;
  if (detailHints.some((w) => t.includes(w))) return false;

  return true;
}

function detectFinishedTopic(text = "") {
  const t = (text || "").trim();

  if (!t) return null;
  if (t.includes("自己分析")) return "self_analysis";
  if (t.includes("求人提案") || t.includes("求人紹介")) return "job_suggestion";
  if (
    t.includes("職務経歴書") ||
    t.includes("経験整理") ||
    t.includes("経歴整理")
  ) {
    return "resume";
  }
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
    ["self_analysis", "job_suggestion", "resume", "interview", "career"].includes(
      explicitIntent
    )
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
  return ["次", "次へ", "続けて", "別案", "ほか"].includes(s);
}

function detectRequestedSuggestionLabel(text = "") {
  const s = String(text || "").trim().toUpperCase();

  if (
    s === "A" ||
    s.includes("Aが気になる") ||
    s.includes("Aを詳しく") ||
    s.includes("Aを深掘り")
  ) {
    return "A";
  }

  if (
    s === "B" ||
    s.includes("Bが気になる") ||
    s.includes("Bを詳しく") ||
    s.includes("Bを深掘り")
  ) {
    return "B";
  }

  if (
    s === "C" ||
    s.includes("Cが気になる") ||
    s.includes("Cを詳しく") ||
    s.includes("Cを深掘り")
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

  const current = await getSession(userId);

  const payload = {
    user_id: userId,
    profile: mergeProfile(current?.profile || {}, patch.profile || {}),
    summary:
      patch.summary !== undefined ? patch.summary : current?.summary || null,
    current_topic:
      patch.current_topic !== undefined
        ? patch.current_topic
        : current?.current_topic || null,
    interview_state:
      patch.interview_state !== undefined
        ? patch.interview_state
        : current?.interview_state || {},
    plan_type: patch.plan_type ?? current?.plan_type ?? "free",
    usage_count:
      typeof patch.usage_count === "number"
        ? patch.usage_count
        : current?.usage_count ?? 0,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("line_ca_sessions")
    .upsert(payload, { onConflict: "user_id" })
    .select()
    .single();

  if (error) {
    console.error("Supabase upsertSession error:", error.message);
    return null;
  }

  return {
    ...data,
    profile: normalizeProfile(data.profile || {}),
    interview_state: normalizeInterviewState(data.interview_state || {}),
    current_topic: data.current_topic || null,
  };
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

function buildJobSuggestionInstruction(profile = {}) {
  return `
今回は「求人提案」として回答してください。

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

function buildJobSuggestionFollowupInstruction(profile = {}, label = "A") {
  return `
今回は「求人提案の深掘り」です。
ユーザーは ${label} 案を詳しく見たい、またはおすすめ順に深掘りしたいと考えています。

重要ルール：
- 前回のA/B/C提案全文を繰り返さない
- 謝罪文は書かない
- 冒頭は自然に
- 今回は ${label} 案だけを深掘りする
- profile にない事実は断定しない
- ユーザーが明示していない経験は断定しない
- 「〜経験を活かせる」と言い切れない場合は、「〜志向と親和性が高い」「〜に挑戦しやすい」と表現する
- LINEで読みやすくする
- 3案全部を再掲しない

案の対応：
- A = 営業企画 / カスタマーサクセス（SaaS企業）
- B = 事業企画 / 新規事業開発（人材業界）
- C = マーケティング企画 / SaaSの営業企画

出力フォーマット：
ありがとうございます。まずは ${label} 案を深掘りします。

【今回深掘りする案】
${label}

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

【次のおすすめアクション】
- この案をさらに深掘りする
- この案向けの職務経歴書整理に進む
- この案向けの面接対策に進む

現在のプロフィール:
${JSON.stringify(profile, null, 2)}
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
- 面接対策
- キャリア相談

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

    const isFollowup =
      currentTopic === "job_suggestion" && isFollowupRequest(userMessage);

    const extraInstructions =
      overrideInstruction ||
      (isJobSuggestionMode && isFollowup
        ? buildJobSuggestionFollowupInstruction(profile, "A")
        : isJobSuggestionMode
        ? buildJobSuggestionInstruction(profile)
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
      model: "gpt-4o-mini",
      messages,
      temperature: isJobSuggestionMode ? 0.4 : 0.7,
    });

    let reply =
      response.choices?.[0]?.message?.content || "うまく回答を作れませんでした。";

    console.log("isJobSuggestionMode =", isJobSuggestionMode);
    console.log("isFollowup =", isFollowup);
    console.log("jobSuggestionFormatValid(first) =", isValidJobSuggestionFormat(reply));

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

      console.log("jobSuggestionFormatValid(retry) =", isValidJobSuggestionFormat(retried));

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
      return "求人提案ですね。希望職種、年収、勤務地、業界、働き方など、わかる範囲で教えてください。";
    case "resume":
      return "職務経歴書・経験整理ですね。これまでの職歴、担当業務、実績をわかる範囲で送ってください。";
    case "interview":
      return "面接対策ですね。受ける職種や企業、想定される質問があれば送ってください。";
    case "career":
      return "キャリア相談ですね。今の悩み、転職したい理由、迷っていることをそのまま送ってください。";
    default:
      return getMainMenuText();
  }
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

        console.log("User message:", userMessage);

        const sessionBefore = await getSession(userId);
        const resolvedTopic = resolveCurrentTopic(
          userMessage,
          sessionBefore?.current_topic || null
        );

        if (resolvedTopic !== (sessionBefore?.current_topic || null)) {
          await upsertSession(userId, { current_topic: resolvedTopic });
        }

        await saveMessage(userId, "user", userMessage);
        const updatedSession = await updateUserProfile(userId, userMessage);

        const menuIntent = detectMenuIntent(userMessage);

        if (menuIntent === "show_menu") {
          const reply = getMainMenuText();
          await saveMessage(userId, "assistant", reply);
          await replyToLine(replyToken, reply);
          continue;
        }

        if (
          (menuIntent === "self_analysis" ||
            menuIntent === "job_suggestion" ||
            menuIntent === "resume" ||
            menuIntent === "interview" ||
            menuIntent === "career") &&
          shouldUseStarterReply(userMessage, menuIntent)
        ) {
          await upsertSession(userId, { current_topic: menuIntent });

          const reply = getStarterReplyByIntent(menuIntent);
          await saveMessage(userId, "assistant", reply);
          await replyToLine(replyToken, reply);
          continue;
        }

        const beforeInterviewState = normalizeInterviewState(
          sessionBefore?.interview_state || {}
        );
        const waitingPreferenceKey = beforeInterviewState.last_asked_preference;
        const updatedProfile = normalizeProfile(updatedSession?.profile || {});
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
            const reply = `ありがとうございます。\n\n次に、もう1点だけ教えてください。\n${nextQuestion.question}\n回答できる範囲で大丈夫です。`;

            await upsertSession(userId, {
              current_topic: "job_suggestion",
              interview_state: {
                ...beforeInterviewState,
                pending_preference_questions: nextQuestion.remainingKeys,
                last_asked_preference: nextQuestion.key,
              },
            });

            await saveMessage(userId, "assistant", reply);
            await replyToLine(replyToken, reply);
            continue;
          } else {
            await upsertSession(userId, {
              current_topic: "job_suggestion",
              interview_state: {
                ...beforeInterviewState,
                pending_preference_questions: [],
                last_asked_preference: null,
              },
            });

            const regeneratedReply = await generateAutoRefinedJobSuggestion(userId);
            const finalReply =
              "ありがとうございます。条件がそろったので、この内容で改めて求人提案します。\n\n" +
              regeneratedReply;

            await saveMessage(userId, "assistant", finalReply);
            await replyToLine(replyToken, finalReply);
            continue;
          }
        }

        // ===== 求人提案の続き =====
        if (activeTopic === "job_suggestion") {
          const sessionNow = await getSession(userId);
          const interviewState = normalizeInterviewState(sessionNow?.interview_state || {});
          const requestedLabel = detectRequestedSuggestionLabel(userMessage);
          const currentStep =
            typeof interviewState.jobSuggestionStep === "number"
              ? interviewState.jobSuggestionStep
              : -1;

          if (requestedLabel) {
            const stepMap = { A: 0, B: 1, C: 2 };
            const targetStep = stepMap[requestedLabel];

            await upsertSession(userId, {
              current_topic: "job_suggestion",
              interview_state: {
                ...interviewState,
                jobSuggestionStep: targetStep,
              },
            });

            const overrideInstruction = buildJobSuggestionFollowupInstruction(
              updatedProfile,
              requestedLabel
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

          if (isFollowupRequest(userMessage)) {
            let targetStep = 0;

            if (isNextRequest(userMessage)) {
              if (currentStep >= 2) {
                const reply = `3つの案を一通り見たので、次は以下に進めます。

- 一番気になる案を決める
- その案向けの職務経歴書を作る
- 面接対策をする

「職務経歴書」または「面接対策」と送ってください。`;

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
              interview_state: {
                ...beforeInterviewState,
                pending_preference_questions: nextQuestion.remainingKeys,
                last_asked_preference: nextQuestion.key,
              },
            });
          } else if (activeTopic === "job_suggestion") {
            await upsertSession(userId, {
              current_topic: "job_suggestion",
              interview_state: {
                ...beforeInterviewState,
                pending_preference_questions: [],
                last_asked_preference: null,
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

// ===== Start Server =====
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});