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
  "https://www.coindesk.com/arc/outboundfeeds/rss/",
  "https://www.binance.com/en/support/announcement/c-48?navId=48"
];

function loadPosted() {
  if (!fs.existsSync(POSTED_FILE)) return [];
  return JSON.parse(fs.readFileSync(POSTED_FILE, "utf8"));
}

function savePosted(items) {
  fs.writeFileSync(POSTED_FILE, JSON.stringify(items.slice(-200), null, 2));
}

function cleanText(text = "") {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPost(item) {
  const title = cleanText(item.title);
  const link = item.link;

  return `📰 WAI NEWS

${title}

🤖 WAI Summary:
Important crypto market update detected. Traders should monitor market reaction and smart money activity.

🔗 Source:
${link}

#WAI #Crypto #WhaleSignals`;
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
      const items = feed.items.slice(0, 3);

      for (const item of items) {
        const id = item.guid || item.link || item.title;

        if (!id || posted.includes(id)) continue;

        const message = formatPost(item);

        await bot.sendMessage(TELEGRAM_CHANNEL_ID, message, {
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
Feeds: ${FEEDS.length}`
  );
});

console.log("WAI News Bot started");

checkNews();
setInterval(checkNews, CHECK_INTERVAL_MINUTES * 60 * 1000);
