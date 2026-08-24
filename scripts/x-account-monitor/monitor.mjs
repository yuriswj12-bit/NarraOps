#!/usr/bin/env node
/**
 * NarraOps X account monitor.
 *
 * Watches fixed X accounts, extracts top-level tweets, normalizes each into a
 * Pulse narrative card, and POSTs them to the NarraOps ingest endpoint
 * (supabase/functions/pulse-narrative-ingest). NarraOps then shows these cards
 * in Pulse and the Agent streams them live.
 *
 * Usage:
 *   node monitor.mjs --once      # single pass, then exit
 *   node monitor.mjs             # loop forever on pollMinutes
 *
 * Config: config.json (copy from config.example.json). Secrets:
 *   - PULSE_NARRATIVE_COLLECTOR_SECRET  (ingest secret, same as the function's)
 *   - optional cookie file path in config for authenticated browsing.
 */

import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATEGORIES = new Set([
  "politics_satire", "events", "animals_characters", "internet_culture", "crypto_native",
]);
const CATEGORY_TERMS = {
  politics_satire: ["president", "election", "government", "trump", "congress", "minister", "politic", "satire", "senator", "parliament", "white house", "campaign"],
  animals_characters: ["cat", "dog", "raccoon", "penguin", "animal", "mascot", "character", "zoo", "puppy", "kitten", "frog", "bear", "otter"],
  internet_culture: ["viral", "meme", "internet", "creator", "streamer", "celebrity", "trend", "tiktok", "youtube", "influencer", "fandom", "cosplay"],
  crypto_native: ["crypto", "bitcoin", "ethereum", "solana", "token", "defi", "blockchain", "memecoin", "airdrop", "nft", "web3", "wallet", "pump"],
};

function loadConfig() {
  const configPath = process.env.X_MONITOR_CONFIG || path.join(HERE, "config.json");
  if (!existsSync(configPath)) {
    throw new Error(`Missing config: ${configPath}. Copy config.example.json to config.json and fill it in.`);
  }
  return JSON.parse(readFileSync(configPath, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function routeCategory(text, hint) {
  const normalized = String(text || "").toLowerCase();
  let best = ""; let bestCount = 0;
  for (const [category, terms] of Object.entries(CATEGORY_TERMS)) {
    const count = terms.reduce((sum, term) => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return sum + (new RegExp(`(^|\\W)${escaped}(?=\\W|$)`, "i").test(normalized) ? 1 : 0);
    }, 0);
    if (count > bestCount) { best = category; bestCount = count; }
  }
  if (bestCount > 0) return best;
  if (hint && CATEGORIES.has(hint) && hint !== "events") return hint;
  return "events";
}

function isReplyOrRetweet(tweetEl) {
  const social = tweetEl.querySelector('[data-testid="socialContext"]');
  if (social) return true;
  const replyChip = tweetEl.querySelector('[data-testid="inlineReplyComposer"]');
  if (replyChip) return true;
  const text = tweetEl.textContent || "";
  if (/^Replying to\b/i.test(text.trim())) return true;
  return false;
}

function extractTweet(tweetEl, handle, now, windowMs, sourceId) {
  const textEl = tweetEl.querySelector('[data-testid="tweetText"]');
  const originalText = (textEl?.textContent || "").trim();
  if (!originalText) return null;

  const link = tweetEl.querySelector('a[href*="/status/"]');
  const statusMatch = link?.getAttribute("href")?.match(/\/status\/(\d+)/);
  if (!statusMatch) return null;
  const statusId = statusMatch[1];
  const sourceUrl = `https://x.com/${handle}/status/${statusId}`;

  const timeEl = tweetEl.querySelector("time");
  const publishedAt = timeEl?.getAttribute("datetime") || new Date(now.getTime()).toISOString();
  const parsed = new Date(publishedAt);
  if (!Number.isFinite(parsed.getTime())) return null;
  const ageMs = now.getTime() - parsed.getTime();
  if (ageMs < 0 || ageMs >= windowMs) return null;

  const mediaUrls = [...tweetEl.querySelectorAll('[data-testid="tweetPhoto"] img, [data-testid="videoPlayer"] video')]
    .map((el) => el.getAttribute("src") || "")
    .filter((src) => /^https?:\/\//.test(src))
    .slice(0, 4);

  return {
    platform: "x",
    source_type: "monitored_account",
    author_name: handle,
    original_text: originalText.slice(0, 2000),
    source_url: sourceUrl,
    media_urls: mediaUrls,
    published_at: parsed.toISOString(),
    category_hint: routeCategory(originalText, null),
    content_fingerprint: sha256(`x\0${sourceId}\0${originalText.toLowerCase()}`),
  };
}

async function collectAccount(page, account, now, config, sourceId) {
  const handle = String(account.handle).replace(/^@/, "").toLowerCase();
  await page.goto(`https://x.com/${handle}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2500);

  const windowMs = (Number(config.windowMinutes) || 240) * 60 * 1000;
  const maxTweets = Number(config.maxTweetsPerAccount) || 20;
  const tweets = await page.$$('[data-testid="tweet"]');
  const cards = [];
  for (const tweetEl of tweets.slice(0, maxTweets)) {
    if (isReplyOrRetweet(tweetEl)) continue;
    const card = extractTweet(tweetEl, handle, now, windowMs, sourceId);
    if (card) cards.push(card);
  }
  return { handle, cards };
}

async function postToIngest(config, sourceId, cards) {
  if (!cards.length) return { status: "empty", accepted: 0, inserted: 0, rejected: 0 };
  const secret = process.env.PULSE_NARRATIVE_COLLECTOR_SECRET
    || config.ingest?.secret
    || "";
  const response = await fetch(config.ingest.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-narraops-collector-secret": secret,
    },
    body: JSON.stringify({ source_id: sourceId, items: cards }),
  });
  const text = await response.text();
  let payload = {};
  try { payload = JSON.parse(text); } catch { /* keep raw */ }
  if (!response.ok) {
    throw new Error(`ingest returned ${response.status}: ${text.slice(0, 200)}`);
  }
  return payload;
}

async function runOnce() {
  const config = loadConfig();
  const accounts = (config.accounts || []).filter((account) => account.enabled !== false);
  if (!accounts.length) throw new Error("No enabled accounts in config");

  const browser = await chromium.launch({ headless: config.headless !== false });
  const context = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
  if (config.cookie?.enabled && config.cookie?.path && existsSync(path.resolve(HERE, config.cookie.path))) {
    const cookiePath = path.resolve(HERE, config.cookie.path);
    const cookies = JSON.parse(readFileSync(cookiePath, "utf8"));
    await context.addCookies(Array.isArray(cookies) ? cookies : []);
  }
  const page = await context.newPage();
  const now = new Date();
  const sourceId = "external-x-monitor";
  const report = { source_id: sourceId, accounts: [], total_cards: 0, ingest: null };
  const allCards = [];

  try {
    for (const account of accounts) {
      try {
        const result = await collectAccount(page, account, now, config, sourceId);
        report.accounts.push({ handle: result.handle, cards: result.cards.length });
        allCards.push(...result.cards);
      } catch (error) {
        report.accounts.push({ handle: String(account.handle), error: error instanceof Error ? error.message.slice(0, 120) : String(error) });
      }
    }
    report.total_cards = allCards.length;
    report.ingest = await postToIngest(config, sourceId, allCards);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
}

const args = process.argv.slice(2);
if (args.includes("--once")) {
  runOnce().then(() => process.exit(0)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
} else {
  const loop = async () => {
    try {
      await runOnce();
    } catch (error) {
      console.error("monitor error:", error instanceof Error ? error.message : error);
    }
    const config = loadConfig();
    const minutes = Number(config.pollMinutes) || 5;
    console.log(`Next pass in ${minutes} minutes...`);
    setTimeout(loop, minutes * 60 * 1000);
  };
  loop();
}