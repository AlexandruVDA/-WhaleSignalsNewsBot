require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const Parser = require("rss-parser");
const fs = require("fs");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

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
const NEWS_MAX_AGE_HOURS = Number(process.env.NEWS_MAX_AGE_HOURS || 6);
const MAX_NEWS_PER_DAY = Number(process.env.MAX_NEWS_PER_DAY || 30);

const POSTED_FILE = "posted.json";
const DAILY_LIMIT_FILE = "daily_limit.json";

const FEEDS = [
  // Crypto
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
  "https://www.coindesk.com/arc/outboundfeeds/rss/",

  // Stock market / macro / gold / commodities
  "https://www.investing.com/rss/news_25.rss",
  "https://www.investing.com/rss/news_95.rss",
  "https://www.investing.com/rss/news_301.rss",
  "https://www.investing.com/rss/news_11.rss"
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function loadPosted() {
  return loadJson(POSTED_FILE, []);
}

function savePosted(items) {
  saveJson(POSTED_FILE, items.slice(-1200));
}

function loadDailyLimit() {
  const daily = loadJson(DAILY_LIMIT_FILE, { date: todayKey(), count: 0 });

  if (daily.date !== todayKey()) {
    return { date: todayKey(), count: 0 };
  }

  return daily;
}

function saveDailyLimit(daily) {
  saveJson(DAILY_LIMIT_FILE, daily);
}

function canPostMoreNews() {
  const daily = loadDailyLimit();
  return daily.count < MAX_NEWS_PER_DAY;
}

function increaseDailyNewsCount() {
  const daily = loadDailyLimit();
  daily.count += 1;
  saveDailyLimit(daily);
}

function cleanText(text = "") {
  return String(text)
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8211;/g, "-")
    .replace(/&#8212;/g, "-")
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
  return cleanText(title)
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shorten(text = "", max = 280) {
  text = cleanText(text);
  if (text.length <= max) return text;
  return text.slice(0, max).trim() + "...";
}

function getDescription(item) {
  return shorten(
    item.contentSnippet ||
    item.summary ||
    item.content ||
    item.contentEncoded ||
    "",
    280
  );
}

function getFullText(item) {
  return `${item.title || ""} ${getDescription(item)} ${item.content || ""} ${item.contentEncoded || ""}`.toLowerCase();
}

function detectCategory(item) {
  const text = getFullText(item);

  if (
    text.includes("gold") ||
    text.includes("xau") ||
    text.includes("silver") ||
    text.includes("oil") ||
    text.includes("commodity") ||
    text.includes("commodities") ||
    text.includes("brent") ||
    text.includes("wti")
  ) return "Gold / Commodities";

  if (
    text.includes("fed") ||
    text.includes("federal reserve") ||
    text.includes("ecb") ||
    text.includes("inflation") ||
    text.includes("cpi") ||
    text.includes("ppi") ||
    text.includes("interest rate") ||
    text.includes("rate cut") ||
    text.includes("rate hike") ||
    text.includes("dollar") ||
    text.includes("dxy") ||
    text.includes("gdp") ||
    text.includes("recession") ||
    text.includes("jobs report") ||
    text.includes("unemployment")
  ) return "Macro";

  if (
    text.includes("nasdaq") ||
    text.includes("s&p 500") ||
    text.includes("dow jones") ||
    text.includes("wall street") ||
    text.includes("stock market") ||
    text.includes("stocks") ||
    text.includes("nvidia") ||
    text.includes("apple") ||
    text.includes("microsoft") ||
    text.includes("tesla")
  ) return "Stocks";

  return "Crypto";
}

function isRelevantMarketNews(item) {
  const text = getFullText(item);

  const keywords = [
    "bitcoin", "btc", "ethereum", "eth", "solana", "sol", "xrp", "crypto", "blockchain",
    "binance", "coinbase", "kraken", "etf", "sec", "whale", "institutional",
    "fed", "federal reserve", "ecb", "inflation", "cpi", "ppi", "interest rate",
    "rate cut", "rate hike", "dollar", "dxy", "gdp", "recession", "jobs report", "unemployment",
    "nasdaq", "s&p 500", "dow jones", "wall street", "stocks", "stock market",
    "nvidia", "apple", "microsoft", "tesla",
    "gold", "xau", "silver", "oil", "commodity", "commodities", "brent", "wti"
  ];

  return keywords.some(keyword => text.includes(keyword));
}

function detectImpact(item) {
  const text = getFullText(item);

  if (
    text.includes("breaking") ||
    text.includes("hack") ||
    text.includes("exploit") ||
    text.includes("liquidation") ||
    text.includes("crash") ||
    text.includes("plunge") ||
    text.includes("surge") ||
    text.includes("lawsuit") ||
    text.includes("sec charges") ||
    text.includes("bankruptcy") ||
    text.includes("emergency") ||
    text.includes("war") ||
    text.includes("attack")
  ) return "Breaking";

  if (
    text.includes("etf") ||
    text.includes("blackrock") ||
    text.includes("fidelity") ||
    text.includes("binance") ||
    text.includes("coinbase") ||
    text.includes("kraken") ||
    text.includes("sec") ||
        text.includes("fed") ||
    text.includes("federal reserve") ||
    text.includes("ecb") ||
    text.includes("cpi") ||
    text.includes("inflation") ||
    text.includes("rate cut") ||
    text.includes("rate hike") ||
    text.includes("jobs report") ||
    text.includes("nasdaq") ||
    text.includes("s&p 500") ||
    text.includes("dow jones") ||
    text.includes("wall street") ||
    text.includes("gold hits") ||
    text.includes("whale") ||
    text.includes("institutional")
  ) return "High";

  if (
    text.includes("bitcoin") ||
    text.includes("btc") ||
    text.includes("ethereum") ||
    text.includes("eth") ||
    text.includes("solana") ||
    text.includes("sol") ||
    text.includes("xrp") ||
    text.includes("market") ||
    text.includes("price") ||
    text.includes("trader") ||
    text.includes("analyst") ||
    text.includes("crypto") ||
    text.includes("stocks") ||
    text.includes("gold") ||
    text.includes("oil") ||
    text.includes("dollar")
  ) return "Medium";

  return "Low";
}

function getSourceName(feedTitle = "", feedUrl = "") {
  const text = `${feedTitle} ${feedUrl}`.toLowerCase();

  if (text.includes("cointelegraph")) return "Cointelegraph";
  if (text.includes("decrypt")) return "Decrypt";
  if (text.includes("theblock")) return "The Block";
  if (text.includes("bitcoinist")) return "Bitcoinist";
  if (text.includes("cryptoslate")) return "CryptoSlate";
  if (text.includes("u.today") || text.includes("utoday")) return "U.Today";
  if (text.includes("newsbtc")) return "NewsBTC";
  if (text.includes("beincrypto")) return "BeInCrypto";
  if (text.includes("cryptopolitan")) return "Cryptopolitan";
  if (text.includes("zycrypto")) return "ZyCrypto";
  if (text.includes("ambcrypto")) return "AMBCrypto";
  if (text.includes("coindesk")) return "CoinDesk";
  if (text.includes("investing.com")) return "Investing.com";

  return "Market News";
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

function isTooOld(item) {
  const dateRaw = item.isoDate || item.pubDate;
  if (!dateRaw) return false;

  const date = new Date(dateRaw);
  if (Number.isNaN(date.getTime())) return false;

  const ageHours = (Date.now() - date.getTime()) / 3600000;
  return ageHours > NEWS_MAX_AGE_HOURS;
}

function isWeakNews(item) {
  const text = getFullText(item);

  return (
    text.includes("podcast") ||
    text.includes("newsletter") ||
    text.includes("video:") ||
    text.includes("sponsored") ||
    text.includes("press release") ||
    text.includes("partner content") ||
    text.includes("opinion")
  );
}

function coverImage(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.width, h / img.height);
  const nw = img.width * scale;
  const nh = img.height * scale;
  const nx = x + (w - nw) / 2;
  const ny = y + (h - nh) / 2;

  ctx.drawImage(img, nx, ny, nw, nh);
}

async function createPremiumCard(item) {
  const width = 1080;
  const height = 1080;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const imageUrl = getImageUrl(item);

  ctx.fillStyle = "#050814";
  ctx.fillRect(0, 0, width, height);

  try {
    const img = await loadImage(imageUrl);
    coverImage(ctx, img, 0, 0, width, height);
  } catch (err) {
    console.log("Image load failed:", err.message);
  }

  return canvas.toBuffer("image/png");
}

function formatCaption(item, sourceName) {
  const category = escapeHtml(detectCategory(item));
  const description = escapeHtml(getDescription(item));
  const impact = escapeHtml(detectImpact(item));

  return `<b>${escapeHtml(sourceName)}</b>
<b>${category}</b>
${description}
<b>Market Impact:</b> ${impact}`;
}

async function postNews(item, sourceName) {
  const cardBuffer = await createPremiumCard(item);
  const caption = formatCaption(item, sourceName);

  await bot.sendPhoto(TELEGRAM_CHANNEL_ID, cardBuffer, {
    caption,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Read Full Article",
            url: item.link
          }
        ]
      ]
    }
  });

  increaseDailyNewsCount();
}

async function checkNews() {
  if (!TELEGRAM_CHANNEL_ID) {
    console.log("Missing TELEGRAM_CHANNEL_ID");
    return;
  }

  if (!canPostMoreNews()) {
    console.log(`Daily news limit reached: ${MAX_NEWS_PER_DAY}`);
    return;
  }

  const posted = loadPosted();

  for (const feedUrl of FEEDS) {
    if (!canPostMoreNews()) break;

    try {
      const feed = await parser.parseURL(feedUrl);
      const sourceName = getSourceName(feed.title || "", feedUrl);

      console.log("RSS FEED:", sourceName, "ITEMS:", feed.items.length);

      const items = feed.items.slice(0, 5);
      let postedFromThisFeed = 0;

      for (const item of items) {
        if (!canPostMoreNews()) break;
        if (postedFromThisFeed >= 1) break;

        const imageUrl = getImageUrl(item);
        const id = item.guid || item.link || item.title;
        const titleKey = "title:" + normalizeTitle(item.title);
        const impact = detectImpact(item);

        if (!id || !item.link) continue;
        if (posted.includes(id) || posted.includes(titleKey)) continue;

        if (!imageUrl) {
          console.log("Skipped - no image:", item.title);
          continue;
        }

        if (isTooOld(item)) {
          console.log(`Skipped - older than ${NEWS_MAX_AGE_HOURS}h:`, item.title);
          continue;
        }

        if (isWeakNews(item)) {
          console.log("Skipped - weak news:", item.title);
          continue;
        }

        if (!isRelevantMarketNews(item)) {
          console.log("Skipped - not relevant market news:", item.title);
          continue;
        }

        if (impact === "Low") {
          console.log("Skipped - low impact:", item.title);
          continue;
        }

        await postNews(item, sourceName);

        posted.push(id);
        posted.push(titleKey);
        savePosted(posted);

        postedFromThisFeed++;

        console.log("Posted:", item.title);

        await sleep(3000);
      }
    } catch (err) {
      console.log("Feed error:", feedUrl, err.message);
    }
  }
}

bot.onText(/\/status/, (msg) => {
  const daily = loadDailyLimit();

  bot.sendMessage(
    msg.chat.id,
    `WAI News Bot

Status: ON
Interval: ${CHECK_INTERVAL_MINUTES} minutes
Feeds: ${FEEDS.length}
Channel: ${TELEGRAM_CHANNEL_ID || "Not set"}

Post style: Clean newspaper card
Daily posts: ${daily.count}/${MAX_NEWS_PER_DAY}
Max age: ${NEWS_MAX_AGE_HOURS}h

Categories:
- Crypto
- Stocks
- Gold / Commodities
- Macro

Filters:
- Breaking / High / Medium only
- Low impact skipped
- Duplicate titles skipped
- Articles without image skipped
- Weak/sponsored content skipped
- Max 1 article per feed per check`
  );
});

bot.onText(/\/testnews/, async (msg) => {
  const testItem = {
    title: "Gold and Bitcoin Rise as Traders Watch Fed Rate Cut Expectations",
    contentSnippet:
      "Markets are watching the Federal Reserve, gold, Bitcoin and major stock indexes as investors adjust risk exposure ahead of key economic data.",
    link: "https://cointelegraph.com/",
    enclosure: {
      url: "https://images.unsplash.com/photo-1621504450181-5d356f61d307?w=1200"
    },
    pubDate: new Date().toUTCString()
  };

  await postNews(testItem, "WAI Test News");
  bot.sendMessage(msg.chat.id, "Test news sent");
});

console.log("WAI News Bot started");
console.log("Interval:", CHECK_INTERVAL_MINUTES, "minutes");
console.log("Max news/day:", MAX_NEWS_PER_DAY);
console.log("Max age:", NEWS_MAX_AGE_HOURS, "hours");
console.log("Feeds:", FEEDS.length);

checkNews();
setInterval(checkNews, CHECK_INTERVAL_MINUTES * 60 * 1000);
