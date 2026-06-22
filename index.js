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
  fs.writeFileSync(POSTED_FILE, JSON.stringify(items.slice(-800), null, 2));
}

function cleanText(text = "") {
  return String(text)
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
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

function shorten(text = "", max = 230) {
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
    230
  );
}

function detectImpact(item) {
  const text = `${item.title || ""} ${getDescription(item)}`.toLowerCase();

  if (
    text.includes("breaking") ||
    text.includes("hack") ||
    text.includes("exploit") ||
    text.includes("liquidation") ||
    text.includes("crash") ||
    text.includes("lawsuit") ||
    text.includes("sec charges") ||
    text.includes("bankruptcy")
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
    text.includes("market") ||
    text.includes("price") ||
    text.includes("trader") ||
    text.includes("analyst")
  ) return "Medium";

  return "Low";
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
  return ageHours > 6;
}

function isWeakNews(item) {
  const text = `${item.title || ""} ${getDescription(item)}`.toLowerCase();

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

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = cleanText(text).split(" ");
  let line = "";
  const lines = [];

  for (const word of words) {
    const testLine = line + word + " ";
    const width = ctx.measureText(testLine).width;

    if (width > maxWidth && line.length > 0) {
      lines.push(line.trim());
      line = word + " ";
    } else {
      line = testLine;
    }

    if (lines.length >= maxLines) break;
  }

  if (lines.length < maxLines && line.trim()) {
    lines.push(line.trim());
  }

  const finalLines = lines.slice(0, maxLines);

  if (finalLines.length === maxLines) {
    finalLines[maxLines - 1] = finalLines[maxLines - 1].replace(/\.*$/, "") + "...";
  }

  finalLines.forEach((l, i) => {
    ctx.fillText(l, x, y + i * lineHeight);
  });
}

function impactColor(impact) {
  if (impact === "Breaking") return "#ff3030";
  if (impact === "High") return "#ff3f8f";
  if (impact === "Medium") return "#ffd23f";
  return "#8c8c8c";
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

  const title = cleanText(item.title || "Crypto Market Update");
  const description = getDescription(item);
  const impact = detectImpact(item);
  const imageUrl = getImageUrl(item);

  ctx.fillStyle = "#050814";
  ctx.fillRect(0, 0, width, height);

  try {
    const img = await loadImage(imageUrl);
    coverImage(ctx, img, 0, 0, width, 780);
  } catch (err) {
    console.log("Image load failed:", err.message);
  }

  const fade = ctx.createLinearGradient(0, 650, 0, 780);
fade.addColorStop(0, "rgba(5,8,20,0)");
fade.addColorStop(1, "rgba(5,8,20,1)");
ctx.fillStyle = fade;
ctx.fillRect(0, 650, width, 130);

ctx.fillStyle = "#050814";
ctx.fillRect(0, 780, width, 300);


  ctx.font = "bold 52px Arial";
  ctx.fillStyle = "#ffffff";
  wrapText(ctx, title, 70, 855, 940, 42, 3);

  ctx.font = "30px Arial";
  ctx.fillStyle = "#d9e1ff";
  wrapText(ctx, description, 70, 930, 940, 42, 2);

  ctx.fillStyle = "#8fb7ff";
  ctx.font = "23px Arial";
  ctx.fillText("Powered by WAI Intelligence", 70, 1010);

  ctx.fillStyle = impactColor(impact);
  ctx.font = "bold 23px Arial";
  ctx.textAlign = "right";
  ctx.fillText(`MARKET IMPACT: ${impact.toUpperCase()}`, 1010, 1010);
  ctx.textAlign = "left";

  return canvas.toBuffer("image/png");
}

function formatCaption(item) {
  return escapeHtml(getDescription(item));
}

async function postNews(item) {
  const cardBuffer = await createPremiumCard(item);
  const caption = formatCaption(item);

  await bot.sendPhoto(TELEGRAM_CHANNEL_ID, cardBuffer, {
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

      const items = feed.items.slice(0, 4);
      let postedFromThisFeed = 0;

      for (const item of items) {
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
          console.log("Skipped - older than 6h:", item.title);
          continue;
        }

        if (isWeakNews(item)) {
          console.log("Skipped - weak news:", item.title);
          continue;
        }

        if (impact === "Low") {
          console.log("Skipped - low impact:", item.title);
          continue;
        }

        await postNews(item);

        posted.push(id);
        posted.push(titleKey);
        savePosted(posted);

        postedFromThisFeed++;

        console.log("Posted:", item.title);

        await new Promise(resolve => setTimeout(resolve, 3000));
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

Post style: Article image card ✅
Filters:
- Breaking / High / Medium only ✅
- Low impact skipped ✅
- Duplicate titles skipped ✅
- Articles without image skipped ✅
- Max age: 6h ✅
- Max 1 article per feed ✅`
  );
});

bot.onText(/\/testnews/, async (msg) => {
  const testItem = {
    title: "Bitcoin Reclaims Key Support As Traders Watch Market Momentum",
    contentSnippet:
      "Bitcoin traders are monitoring key support and resistance levels as market volatility increases and institutional flows remain in focus.",
    link: "https://cointelegraph.com/",
    enclosure: {
      url: "https://images.unsplash.com/photo-1621504450181-5d356f61d307?w=1200"
    },
    pubDate: new Date().toUTCString()
  };

  await postNews(testItem);
  bot.sendMessage(msg.chat.id, "✅ Test news sent");
});

console.log("WAI News Bot started");

checkNews();
setInterval(checkNews, CHECK_INTERVAL_MINUTES * 60 * 1000);
