require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const Parser = require("rss-parser");
const fs = require("fs");

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

const parser = new Parser({
  customFields: {
    item: [
      ["media:content", "mediaContent"],
      ["media:thumbnail", "mediaThumbnail"],
      ["content:encoded", "contentEncoded"]
    ]
  }
});

const TELEGRAM_CHANNEL_ID = String(process.env.TELEGRAM_CHANNEL_ID || "");
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
  "https://zycrypto.com/feed",
  "https://ambcrypto.com/feed",
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
  fs.writeFileSync(POSTED_FILE, JSON.stringify(items.slice(-600), null, 2));
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

function normalizeTitle(title = "") {
  return cleanText(title).toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

function detectImpact(title = "") {
  const t = String(title).toLowerCase();

  if (
    t.includes("breaking") ||
    t.includes("hack") ||
    t.includes("exploit") ||
    t.includes("liquidation") ||
    t.includes("crash") ||
    t.includes("emergency")
  ) return "🚨 Market Impact: Breaking";

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
  ) return "Market Impact: High";

  if (
    t.includes("futures") ||
    t.includes("staking") ||
    t.includes("market") ||
    t.includes("price") ||
    t.includes("trader") ||
    t.includes("analyst")
  ) return "Market Impact: Medium";

  return "Market Impact: Low";
}

function getImageUrl(item) {
  if (item.enclosure?.url) return item.enclosure.url;

  if (item.mediaContent) {
    if (Array.isArray(item.mediaContent)) {
      const found = item.mediaContent.find(x => x?.$?.url);
      if (found) return found.$.url;
    }
    if (item.mediaContent.$?.url) return item.mediaContent.$.url;
  }

  if (item.mediaThumbnail) {
    if (Array.isArray(item.mediaThumbnail)) {
      const found = item.mediaThumbnail.find(x => x?.$?.url);
      if (found) return found.$.url;
    }
    if (item.mediaThumbnail.$?.url) return item.mediaThumbnail.$.url;
  }

  const html = item.content || item.contentEncoded || item.summary || "";
  const match = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  if (match?.[1]) return match[1];

  return "";
}

function shorten(text = "", max = 230) {
  text = cleanText(text);
  if (text.length <= max) return text;
  return text.slice(0, max).trim() + "...";
}

function getDescription(item) {
  const raw =
    item.contentSnippet ||
    item.summary ||
    item.content ||
    item.contentEncoded ||
    "";

  return shorten(raw, 230);
}

function formatCaption(item) {
  const description = escapeHtml(getDescription(item));
  const impact = escapeHtml(detectImpact(item.title));

  return `${description}
<b>${impact}</b>`;
}

function isTooOld(item) {
  const dateRaw = item.isoDate || item.pubDate;
  if (!dateRaw) return false;

  const date = new Date(dateRaw);
  if (Number.isNaN(date.getTime())) return false;

  const ageHours = (Date.now() - date.getTime()) / 3600000;
  return ageHours > 6;
}

function isWeakNews(item) {
  const title = String(item.title || "").toLowerCase();

  return (
    title.includes("podcast") ||
    title.includes("newsletter") ||
    title.includes("video:") ||
    title.includes("sponsored") ||
    title.includes("press release")
  );
}

async function postNews(item) {
  const imageUrl = getImageUrl(item);
  const caption = formatCaption(item);

  await bot.sendPhoto(TELEGRAM_CHANNEL_ID, imageUrl, {
    caption,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "📖 Read Full Article",
            url: item.link
          }
        ]
      ]
    }
  });
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
      console.log("RSS FEED:", feedUrl, "ITEMS:", feed.items.length);

      const items = feed.items.slice(0, 2);

      for (const item of items) {
        const imageUrl = getImageUrl(item);
        const id = item.guid || item.link || item.title;
        const titleKey = "title:" + normalizeTitle(item.title);

        if (!id) continue;
        if (posted.includes(id) || posted.includes(titleKey)) continue;

        if (!imageUrl) {
          console.log("Skipped - no preview image:", item.title);
          continue;
        }

        if (isTooOld(item)) {
          console.log("Skipped - older than 24h:", item.title);
          continue;
        }

        if (isWeakNews(item)) {
          console.log("Skipped - weak news:", item.title);
          continue;
        }

        await postNews(item);

        posted.push(id);
        posted.push(titleKey);
        savePosted(posted);

        console.log("Posted:", item.title);
      }
    } catch (err) {
      console.log("Feed error:", feedUrl, err.message);
    }
  }
}

bot.onText(/\/status/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `📰 WAI News Bot

Status: ON ✅
Interval: ${CHECK_INTERVAL_MINUTES} minutes
Feeds: ${FEEDS.length}
Channel: ${TELEGRAM_CHANNEL_ID || "Not set"}
Post style: Premium compact card ✅
Filters:
- No duplicate titles ✅
- No articles without preview image ✅
- Max age: 24h ✅
- 2 articles per feed ✅`
  );
});

bot.onText(/\/testnews/, async (msg) => {
  if (!TELEGRAM_CHANNEL_ID) {
    return bot.sendMessage(msg.chat.id, "❌ TELEGRAM_CHANNEL_ID missing");
  }

  await bot.sendPhoto(
    TELEGRAM_CHANNEL_ID,
    "https://images.cointelegraph.com/images/1480_aHR0cHM6Ly9zMy5jb2ludGVsZWdyYXBoLmNvbS91cGxvYWRzLzIwMjQtMDIvMTQ4MGYyMzgtY2QyYi00NzVjLTk2YzctNzYyYTU5ZmM3YjI0LmpwZw==.jpg",
    {
      caption: `Standard Chartered’s Geoff Kendrick tells clients “winter is over” as crypto prices may have found a cycle low.

<b>Market Impact: Low</b>`,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "📖 Read Full Article",
              url: "https://cointelegraph.com/"
            }
          ]
        ]
      }
    }
  );

  bot.sendMessage(msg.chat.id, "✅ Test news sent");
});

console.log("WAI News Bot started");

checkNews();
setInterval(checkNews, CHECK_INTERVAL_MINUTES * 60 * 1000);
