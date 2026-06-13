require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const Parser = require("rss-parser");
const fs = require("fs");

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const parser = new Parser();

const TELEGRAM_CHANNEL_ID = String(process.env.TELEGRAM_CHANNEL_ID || "");
const CHECK_INTERVAL_MINUTES = Number(process.env.CHECK_INTERVAL_MINUTES || 15);
const POSTED_FILE = "posted.json";

const FEEDS = [
  "https://cointelegraph.com/rss",
  "https://www.coindesk.com/arc/outboundfeeds/rss/"
];

function loadPosted() {
  try {
    if (!fs.existsSync(POSTED_FILE)) return [];
    return JSON.parse(fs.readFileSync(POSTED_FILE, "utf8"));
  } catch {
    return [];
  }
}

function savePosted(items) {
  fs.writeFileSync(POSTED_FILE, JSON.stringify(items.slice(-300), null, 2));
}

function cleanText(text = "") {
  return String(text)
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(text = "") {
  return String(text).replace(/"/g, "&quot;");
}

function detectImpact(title = "") {
  const t = String(title).toLowerCase();

  if (
    t.includes("breaking") ||
    t.includes("hack") ||
    t.includes("exploit") ||
    t.includes("liquidation") ||
    t.includes("sec approves") ||
    t.includes("etf approved") ||
    t.includes("crash") ||
    t.includes("emergency")
  ) {
    return "🚨 <b>BREAKING NEWS</b>";
  }

  if (
    t.includes("bullish") ||
    t.includes("institutional") ||
    t.includes("adoption") ||
    t.includes("record") ||
    t.includes("whale") ||
    t.includes("etf") ||
    t.includes("blackrock") ||
    t.includes("binance") ||
    t.includes("coinbase")
  ) {
    return "🔴 <b>HIGH IMPACT</b>";
  }

  if (
    t.includes("futures") ||
    t.includes("staking") ||
    t.includes("market") ||
    t.includes("price") ||
    t.includes("trader") ||
    t.includes("analyst")
  ) {
    return "🟠 <b>MEDIUM IMPACT</b>";
  }

  return "🟢 <b>LOW IMPACT</b>";
}

function formatPost(item) {
  const title = escapeHtml(cleanText(item.title));
  const link = escapeAttr(item.link || "");
  const impact = detectImpact(item.title);

  return `📰 <b>${title}</b>

${impact}
🐋 Whale activity worth monitoring.

<a href="${link}">Read full article</a>`;
}

async function checkNews() {
  if (!TELEGRAM_CHANNEL_ID) {
    console.log("Missing TELEGRAM_CHANNEL_ID");
    return;
  }

  const posted = loadPosted();

  for (const feedUrl of FEEDS) {
    try {
      const feed = await parser.parseURL(feedUrl);
      const items = feed.items.slice(0, 5);

      for (const item of items) {
        const id = item.guid || item.link || item.title;
        if (!id || posted.includes(id)) continue;

        const message = formatPost(item);

        await bot.sendMessage(TELEGRAM_CHANNEL_ID, message, {
          parse_mode: "HTML",
          disable_web_page_preview: false
        });

        posted.push(id);
        savePosted(posted);

        console.log("Posted:", item.title);
        return;
      }
    } catch (err) {
      console.log("Feed error:", feedUrl, err.message);
    }
  }
}

bot.on("channel_post", (msg) => {
  console.log("CHANNEL ID:", msg.chat.id);
  console.log("TITLE:", msg.chat.title);
});

bot.onText(/\/status/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `📰 WAI News Bot

Status: ON ✅
Interval: ${CHECK_INTERVAL_MINUTES} minutes
Feeds: ${FEEDS.length}
Channel: ${TELEGRAM_CHANNEL_ID || "Not set"}`
  );
});

bot.onText(/\/testnews/, async (msg) => {
  if (!TELEGRAM_CHANNEL_ID) {
    return bot.sendMessage(msg.chat.id, "❌ TELEGRAM_CHANNEL_ID missing");
  }

  await bot.sendMessage(
    TELEGRAM_CHANNEL_ID,
    `📰 <b>WAI News Bot Test</b>

🟠 <b>MEDIUM IMPACT</b>
🐋 Whale activity worth monitoring.

<a href="https://cointelegraph.com/">Read full article</a>`,
    {
      parse_mode: "HTML",
      disable_web_page_preview: false
    }
  );

  bot.sendMessage(msg.chat.id, "✅ Test news sent");
});

console.log("WAI News Bot started");

checkNews();
setInterval(checkNews, CHECK_INTERVAL_MINUTES * 60 * 1000);
