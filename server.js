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

function isFollowupRequest(text = "") {
  const s = String(text || "").trim();
  return [
    "お願いします",
    "お願い",
    "次",
    "続けて",
    "続き",
    "もっと詳しく",
    "詳しく",
    "具体的に",
    "深掘り",
    "もっと",
  ].includes(s);
}

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

${buildConditionStatusInstruction(profile)}
`;
}

function buildJobSuggestionFollowupInstruction(profile = {}) {
  return `
今回は「求人提案の深掘り」です。
ユーザーは直前のA/B/C提案を見た上で、「お願いします」「次」「もっと詳しく」などの継続メッセージを送っています。

重要ルール：
- 前回のA/B/C提案全文を繰り返さない
- 謝罪文は書かない
- 冒頭は自然に
- 応募優先度が高い案から1つだけ深掘りする
- 既に深掘り済みかどうかは履歴を見て、できるだけ同じ深掘りを繰り返さない
- まだ深掘りされていなさそうな案を優先する
- profile にない事実は断定しない
- ユーザーが明示していない経験は断定しない
- 「〜経験を活かせる」と言い切れない場合は、「〜志向と親和性が高い」「〜に挑戦しやすい」と表現する
- LINEで読みやすくする
- 3案全部を再掲しない

出力フォーマット：
ありがとうございます。今回は、前回の提案の中から最も優先度が高い案を1つ深掘りします。

【今回深掘りする案】
A / B / C のいずれか

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
- 求人の深掘りを続ける
- 職務経歴書整理に進む
- 面接対策に進む

補足：
- Aが最優先なら、まずAを深掘りする
- 次に「次」と来たらB、その次はC、のように履歴を見てなるべく重複を避ける
- profile の希望勤務地、年収、出社頻度、業界希望、避けたいことを必ず反映する

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
    const beforeA = s.slice(0, startIndex).trim();

    if (!beforeA) {
      return `${allowedLead}\n\n${s.slice(startIndex).trim()}`;
    }

    if (
      beforeA.includes("ありがとうございます！あなたの希望条件に基づいて、以下の求人提案を考えてみました。")
    ) {
      return `${allowedLead}\n\n${s.slice(startIndex).trim()}`;
    }

    return `${allowedLead}\n\n${s.slice(startIndex).trim()}`;
  }

  return s;
}

// ===== Conversation History Helpers =====
function hasDeepDiveStructure(text = "") {
  const s = String(text || "");
  return (
    s.includes("【今回深掘りする案】") &&
    s.includes("【向いている人】") &&
    s.includes("【想定される仕事内容】")
  );
}

// ===== OpenAI Ask =====
async function askOpenAI(userId, userMessage, forcedTopic = null) {
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
      isJobSuggestionMode && isFollowup
        ? buildJobSuggestionFollowupInstruction(profile)
        : isJobSuggestionMode
        ? buildJobSuggestionInstruction(profile)
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

    if (isJobSuggestionMode && !isFollowup && !isValidJobSuggestionFormat(reply)) {
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

    if (isJobSuggestionMode && !isFollowup) {
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

        console.log("resolvedTopic =", resolvedTopic);
        console.log("session current_topic =", sessionBefore?.current_topic);
        console.log(
          "isJobSuggestionMode =",
          isJobSuggestionContext(userMessage) ||
            (resolvedTopic || sessionBefore?.current_topic) === "job_suggestion"
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
        const isFollowup =
          activeTopic === "job_suggestion" && isFollowupRequest(userMessage);

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

        const assistantReply = await askOpenAI(userId, userMessage, activeTopic);

        let finalReply = assistantReply;
        const finishedTopic = detectFinishedTopic(userMessage);

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
                pending_preference_questions: nextQuestion.remainingKeys,
                last_asked_preference: nextQuestion.key,
              },
            });
          } else if (activeTopic === "job_suggestion") {
            await upsertSession(userId, {
              current_topic: "job_suggestion",
              interview_state: {
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