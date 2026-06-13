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

function detectTags(title = "") {
  const t = title.toLowerCase();
  const tags = ["#WAI", "#Crypto", "#WhaleSignals"];

  if (t.includes("bitcoin") || t.includes("btc")) tags.push("#BTC");
  if (t.includes("ethereum") || t.includes("eth")) tags.push("#ETH");
  if (t.includes("binance") || t.includes("bnb")) tags.push("#BNB");
  if (t.includes("solana") || t.includes("sol")) tags.push("#SOL");
  if (t.includes("xrp")) tags.push("#XRP");
  if (t.includes("etf")) tags.push("#ETF");
  if (t.includes("hack") || t.includes("exploit")) tags.push("#Security");
  if (t.includes("whale") || t.includes("wallet")) tags.push("#SmartMoney");

  return [...new Set(tags)].join(" ");
}

function detectImpact(title = "") {
  const t = title.toLowerCase();

  if (
    t.includes("hack") ||
    t.includes("exploit") ||
    t.includes("lawsuit") ||
    t.includes("sec") ||
    t.includes("ban")
  ) {
    return "⚠️ <b>Risk Watch:</b>\nThis update may increase volatility. Monitor exchange flows, whale exits and liquidity movement.";
  }

  if (
    t.includes("etf") ||
    t.includes("approval") ||
    t.includes("listing") ||
    t.includes("partnership")
  ) {
    return "📈 <b>Market Impact:</b>\nPotential positive catalyst. Watch smart money accumulation and major wallet activity.";
  }

  if (
    t.includes("price") ||
    t.includes("surge") ||
    t.includes("rally") ||
    t.includes("drops") ||
    t.includes("crash")
  ) {
    return "📊 <b>Market Impact:</b>\nPrice-sensitive update. Watch BTC, ETH and large-cap liquidity reaction.";
  }

  return "🐋 <b>WAI Intelligence:</b>\nA relevant crypto market update was detected. Monitor whale activity, exchange flows and smart money reaction.";
}

function formatPost(item) {
  const title = escapeHtml(cleanText(item.title));
  const link = item.link || "";
  const tags = detectTags(item.title);
  const impact = detectImpact(item.title);

 return `📰 <b>WAI MARKET NEWS</b>

<b>${title}</b>

${impact}

🔎 <b>What to watch:</b>
• Whale transfers
• Exchange inflows/outflows
• BTC & ETH reaction
• Smart money positioning

🔗 <b>Source:</b>
${link}

return `📰 <b>WAI MARKET NEWS</b>

<b>${title}</b>

${impact}

🔎 <b>What to watch:</b>
• Whale transfers
• Exchange inflows/outflows
• BTC & ETH reaction
• Smart money positioning

🔗 <b>Source:</b>
${link}

━━━━━━━━━━━━━━
🐋 Powered by WAI Intelligence
🛰️ Smart Money Monitoring
📰 #CryptoNews #WAI #SmartMoney ${tags}
`;
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
    `📰 <b>WAI MARKET NEWS TEST</b>

<b>Bot connection test completed successfully.</b>

🐋 <b>WAI Intelligence:</b>
The WAI News Bot is connected to the official WAI News channel.

🔎 <b>Status:</b>
• Telegram: Online ✅
• Railway: Online ✅
• News Feed: Active ✅

#WAI #Crypto #WhaleSignals`,
    {
      parse_mode: "HTML",
      disable_web_page_preview: true
    }
  );

  bot.sendMessage(msg.chat.id, "✅ Test news sent");
});

console.log("WAI News Bot started");

checkNews();
setInterval(checkNews, CHECK_INTERVAL_MINUTES * 60 * 1000);
