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
            text: text.slice(0, 5000),
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

// ===== LINE Push (optional) =====
async function pushToLine(userId, text) {
  try {
    await axios.post(
      "https://api.line.me/v2/bot/message/push",
      {
        to: userId,
        messages: [
          {
            type: "text",
            text: text.slice(0, 5000),
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
    console.error("LINE push error:", error.response?.data || error.message);
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
    t.includes("メニュー") ||
    t.includes("一覧") ||
    t.includes("話を変えたい") ||
    t.includes("テーマ変えたい") ||
    t.includes("他に何できる")
  ) {
    return "show_menu";
  }

  if (t === "1" || t.includes("自己分析")) return "self_analysis";

  if (
    t === "2" ||
    t.includes("求人提案") ||
    t.includes("求人を提案") ||
    t.includes("求人紹介")
  ) {
    return "job_suggestion";
  }

  if (
    t === "3" ||
    t.includes("職務経歴書") ||
    t.includes("経験整理") ||
    t.includes("経歴整理")
  ) {
    return "resume";
  }

  if (t === "4" || t.includes("面接対策")) return "interview";

  if (t === "5" || t.includes("キャリア相談")) return "career";

  return null;
}

function detectFinishedTopic(text = "") {
  const t = (text || "").trim();

  if (!t) return null;
  if (t.includes("自己分析")) return "self_analysis";
  if (t.includes("求人提案") || t.includes("求人紹介")) return "job_suggestion";
  if (t.includes("職務経歴書") || t.includes("経験整理") || t.includes("経歴整理")) {
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

ルール：
- 会話の途中でテーマが変わっても自然に対応する
- ユーザーが迷っていそうなら、今できることを短く案内する
- 「求人検索」ではなく「求人提案」という表現を使う
- 回答はLINEで読みやすい長さと改行を意識する
- 上から目線にならない
- 不明点は決めつけず、確認ベースで伝える
- できるだけ次の一歩が明確になるように返す
`;

// ===== OpenAI Ask =====
async function askOpenAI(userId, userMessage) {
  try {
    const history = await getRecentMessages(userId, 12);

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
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

        // 1. ユーザー発話を保存
        await saveMessage(userId, "user", userMessage);

        // 2. メニュー系の即時分岐
        const menuIntent = detectMenuIntent(userMessage);

        if (menuIntent === "show_menu") {
          const reply = getMainMenuText();
          await saveMessage(userId, "assistant", reply);
          await replyToLine(replyToken, reply);
          continue;
        }

        if (
          menuIntent === "self_analysis" ||
          menuIntent === "job_suggestion" ||
          menuIntent === "resume" ||
          menuIntent === "interview" ||
          menuIntent === "career"
        ) {
          const reply = getStarterReplyByIntent(menuIntent);
          await saveMessage(userId, "assistant", reply);
          await replyToLine(replyToken, reply);
          continue;
        }

        // 3. 通常会話はOpenAIへ
        const assistantReply = await askOpenAI(userId, userMessage);

        // 4. 必要ならメニューを追加
        let finalReply = assistantReply;
        const finishedTopic = detectFinishedTopic(userMessage);

        if (finishedTopic) {
          finalReply += `\n\n---\n${getNextActionMenuByTopic(finishedTopic)}`;
        } else if (shouldAppendMenu(userMessage, assistantReply)) {
          finalReply += `\n\n---\n${getMainMenuText()}`;
        }

        // 5. AI返答を保存
        await saveMessage(userId, "assistant", finalReply);

        // 6. LINE返信
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