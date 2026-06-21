require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const Parser = require("rss-parser");
const fs = require("fs");

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
const parser = new Parser();

const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const CHECK_INTERVAL_MINUTES = Number(process.env.CHECK_INTERVAL_MINUTES || 15);
const POSTED_FILE = "posted.json";

const FEEDS = [
  "https://cointelegraph.com/rss",
  "https://decrypt.co/feed",
  "https://www.theblock.co/rss.xml",
  "https://bitcoinist.com/feed",
  "https://cryptoslate.com/feed",
  "https://u.today/rss",
  "https://www.newsbtc.com/feed",
  "https://beincrypto.com/feed",
  "https://www.cryptopolitan.com/feed",
  "https://zycrypto.com/feed"
];

function loadPosted() {
  if (!fs.existsSync(POSTED_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(POSTED_FILE, "utf8"));
  } catch {
    return [];
  }
}

function savePosted(posted) {
  fs.writeFileSync(POSTED_FILE, JSON.stringify(posted.slice(0, 500), null, 2));
}

function cleanText(text = "") {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function shortText(text, max = 220) {
  const clean = cleanText(text);
  if (clean.length <= max) return clean;
  return clean.slice(0, max).trim() + "...";
}

function getImpact(title = "", content = "") {
  const text = `${title} ${content}`.toLowerCase();

  if (
    text.includes("sec") ||
    text.includes("cftc") ||
    text.includes("lawsuit") ||
    text.includes("sued") ||
    text.includes("hack") ||
    text.includes("exploit") ||
    text.includes("etf") ||
    text.includes("fed") ||
    text.includes("binance") ||
    text.includes("coinbase")
  ) {
    return "High";
  }

  if (
    text.includes("bitcoin") ||
    text.includes("ethereum") ||
    text.includes("solana") ||
    text.includes("whale") ||
    text.includes("liquidation") ||
    text.includes("futures")
  ) {
    return "Medium";
  }

  return "Low";
}

function isRecent(item) {
  const date = item.isoDate || item.pubDate;
  if (!date) return true;

  const published = new Date(date).getTime();
  const now = Date.now();
  const sixHours = 6 * 60 * 60 * 1000;

  return now - published <= sixHours;
}

async function fetchNews() {
  const posted = loadPosted();

  for (const feed of FEEDS) {
    try {
      const data = await parser.parseURL(feed);

      for (const item of data.items || []) {
        const link = item.link;
        if (!link || posted.includes(link)) continue;
        if (!isRecent(item)) continue;

        const title = cleanText(item.title || "Crypto News");
        const description = shortText(
          item.contentSnippet || item.summary || item.content || "",
          240
        );

        const impact = getImpact(title, description);

        const message =
`📰 ${title}

${description}

Market Impact: ${impact}`;

        await bot.sendMessage(TELEGRAM_CHANNEL_ID, message, {
          parse_mode: "HTML",
          disable_web_page_preview: false,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "📖 Read Full Article",
                  url: link
                }
              ]
            ]
          }
        });

        posted.unshift(link);
        savePosted(posted);

        console.log(`Posted: ${title}`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } catch (err) {
      console.error(`Feed error: ${feed}`, err.message);
    }
  }
}

async function start() {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error("Missing TELEGRAM_BOT_TOKEN");
    process.exit(1);
  }

  if (!TELEGRAM_CHANNEL_ID) {
    console.error("Missing TELEGRAM_CHANNEL_ID");
    process.exit(1);
  }

  console.log("WAI News Bot started");
  await fetchNews();

  setInterval(fetchNews, CHECK_INTERVAL_MINUTES * 60 * 1000);
}

start();
