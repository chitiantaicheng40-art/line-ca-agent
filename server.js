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

// ===== Job Suggestion Formatting =====
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

function buildJobSuggestionInstruction() {
  return `
今回は「求人提案」として回答してください。

出力ルール：
- LINEで読みやすい見出し付き
- 必ず3パターンで提案する
- 順番は以下で固定

【A. 安定寄り】
- おすすめ理由
- 合う点
- 懸念点

【B. 成長寄り】
- おすすめ理由
- 合う点
- 懸念点

【C. バランス寄り】
- おすすめ理由
- 合う点
- 懸念点

最後に必ず
【次に確認したいこと】
を付ける

【出力イメージ】
【A. 安定寄り】
職種例：既存顧客向け営業企画 / カスタマーサクセス企画 / 事業企画補佐

- おすすめ理由
営業経験を活かしながら、比較的企画寄りにシフトしやすい。
既存事業の改善や運用設計に関わるため、未経験でも入りやすい。

- 合う点
・営業経験をそのまま活かせる
・年収600万以上・フルリモート求人も比較的ある
・急激なキャリアチェンジになりにくい

- 懸念点
・企画の裁量は限定的な場合がある
・事業企画や経営企画ほど上流には入りにくい

【B. 成長寄り】
職種例：事業企画 / 新規事業企画 / プロダクトマネージャー候補

- おすすめ理由
営業経験に加えて、企画・戦略・事業推進まで経験したい場合に向いている。
今後の市場価値を大きく上げやすい。

- 合う点
・企画寄りに最もシフトしやすい
・将来的に年収800〜1000万以上も狙いやすい
・経営層や事業責任者に近い仕事ができる

- 懸念点
・未経験だと最初はハードルが高い
・フルリモート求人はやや少なめ
・選考では論理性や数字感覚を求められやすい

【C. バランス寄り】
職種例：企画営業 / マーケティング企画 / SaaSの営業企画

- おすすめ理由
営業経験を活かしながら、企画やマーケ寄りの仕事にも広げられる。
安定と成長のバランスが良い。

- 合う点
・営業経験との親和性が高い
・フルリモート・600万以上の求人も比較的多い
・将来的に事業企画やマーケ責任者にも広げやすい

- 懸念点
・会社によっては営業色が強く残る
・「企画」と言いながら、実際は営業推進に近い求人も多い

【次に確認したいこと】
- どのくらい企画寄りに行きたいか
- SaaS / IT / 人材 / メーカーなど、興味のある業界
- フルリモート必須か、週1〜2出社なら許容できるか
- 年収600万以上の中でも、最低ラインと理想ライン
- 今後「マネジメント」と「専門性」のどちらを伸ばしたいか

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
- profile にない条件を勝手に補わない
- 3案の違いがはっきり分かるようにする
- 必ずA/B/Cの順番で出す
- 1案あたり長くしすぎない
- LINEで読みやすいように、空行と箇条書きを使う
- 各案の職種例は、可能なら業界名も入れる（例：SaaS企業の営業企画 / 人材会社の事業企画）
`;
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

function buildMissingQuestionsMessage(profile = {}) {
  const missing = getMissingPreferenceFields(profile);
  if (missing.length === 0) return "";

  const lines = missing.map((item, index) => `${index + 1}. ${item.question}`);

  return `\n\n---\nよりマッチ度の高い求人に絞るため、差し支えない範囲で以下だけ教えてください。\n${lines.join(
    "\n"
  )}\n回答できるものだけで大丈夫です。`;
}

function shouldAskMissingPreferences(aiReply = "") {
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
  ];

  return proposalHints.some((word) => text.includes(word));
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
  };
}

async function upsertSession(userId, patch = {}) {
  if (!supabase) return null;

  const existing = await getSession(userId);

  const currentProfile = normalizeProfile(existing?.profile || {});
  const mergedProfile = mergeProfile(currentProfile, patch.profile || {});

  const payload = {
    user_id: userId,
    profile: mergedProfile,
    summary: patch.summary ?? existing?.summary ?? null,
    interview_state: patch.interview_state ?? existing?.interview_state ?? null,
    plan_type: patch.plan_type ?? existing?.plan_type ?? "free",
    usage_count:
      typeof patch.usage_count === "number"
        ? patch.usage_count
        : existing?.usage_count ?? 0,
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
  };
}

function mergeUniqueStringArray(oldArr = [], newArr = []) {
  return [...new Set([...(oldArr || []), ...(newArr || [])])];
}

function mergeProfile(existingProfile = {}, newPatch = {}) {
  const base = normalizeProfile(existingProfile);

  const merged = {
    ...base,
    ...newPatch,
  };

  if (base.experience_keywords || newPatch.experience_keywords) {
    merged.experience_keywords = mergeUniqueStringArray(
      base.experience_keywords || [],
      newPatch.experience_keywords || []
    );
  }

  if (base.interest_keywords || newPatch.interest_keywords) {
    merged.interest_keywords = mergeUniqueStringArray(
      base.interest_keywords || [],
      newPatch.interest_keywords || []
    );
  }

  if (base.preferred_industries || newPatch.preferred_industries) {
    merged.preferred_industries = mergeUniqueStringArray(
      base.preferred_industries || [],
      newPatch.preferred_industries || []
    );
  }

  if (base.avoid_points_in_current_job || newPatch.avoid_points_in_current_job) {
    merged.avoid_points_in_current_job = mergeUniqueStringArray(
      base.avoid_points_in_current_job || [],
      newPatch.avoid_points_in_current_job || []
    );
  }

  return normalizeProfile(merged);
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
- minimum_salary はユーザー表現のままでよい（例："500万円以上", "現年収以上"）
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
async function askOpenAI(userId, userMessage) {
  try {
    const history = await getRecentMessages(userId, 12);
    const session = await getSession(userId);
    const profile = normalizeProfile(session?.profile || {});
    const summary = session?.summary || "";

    const extraInstructions = isJobSuggestionContext(userMessage)
      ? buildJobSuggestionInstruction()
      : "";

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
      temperature: 0.7,
    });

    return response.choices?.[0]?.message?.content || "うまく回答を作れませんでした。";
  } catch (error) {
    console.error("OpenAI error:", error.response?.data || error.message);
    return "すみません、今ちょっと調子が悪いです。もう一度送ってください。";
  }
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
          const reply = getStarterReplyByIntent(menuIntent);
          await saveMessage(userId, "assistant", reply);
          await replyToLine(replyToken, reply);
          continue;
        }

        const assistantReply = await askOpenAI(userId, userMessage);

        let finalReply = assistantReply;
        const finishedTopic = detectFinishedTopic(userMessage);

        if (shouldAskMissingPreferences(assistantReply)) {
          const missingQuestions = buildMissingQuestionsMessage(
            updatedSession?.profile || {}
          );
          if (missingQuestions) {
            finalReply += missingQuestions;
          }
        }

        if (finishedTopic) {
          finalReply += `\n\n---\n${getNextActionMenuByTopic(finishedTopic)}`;
        } else if (shouldAppendMenu(userMessage, assistantReply)) {
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