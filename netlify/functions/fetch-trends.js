// netlify/functions/fetch-trends.js

// Helper: fetch with timeout
async function fetchWithTimeout(url, ms = 7000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}


const fetch = require("node-fetch");
const cheerio = require("cheerio");

// 🔹 Hacker News (Tech)
async function fetchHackerNews() {
  try {
    const res = await fetch("https://hnrss.org/frontpage.jsonfeed");
    const data = await res.json();
    return data.items.map(item => ({ title: item.title, link: item.url }));
  } catch (err) {
    console.warn("HackerNews fetch failed", err.message);
    return [];
  }
}

// 🔹 BBC World
async function fetchBBCWorld() {
  try {
    const res = await fetch("https://feeds.bbci.co.uk/news/world/rss.xml");
    const text = await res.text();
    const $ = cheerio.load(text, { xmlMode: true });
    return $("item").map((_, el) => ({
      title: $(el).find("title").text(),
      link: $(el).find("link").text(),
    })).get();
  } catch (err) {
    console.warn("BBC fetch failed", err.message);
    return [];
  }
}

// 🔹 VnExpress (Vietnam News)
async function fetchVnExpress() {
  try {
    const res = await fetch("https://vnexpress.net/rss/tin-moi-nhat.rss");
    const text = await res.text();
    const $ = cheerio.load(text, { xmlMode: true });
    return $("item").map((_, el) => ({
      title: $(el).find("title").text(),
      link: $(el).find("link").text(),
    })).get();
  } catch (err) {
    console.warn("VnExpress fetch failed", err.message);
    return [];
  }
}

// 🔹 Yahoo Finance
async function fetchYahooFinance() {
  try {
    const res = await fetch("https://finance.yahoo.com/rss/topstories");
    const text = await res.text();
    const $ = cheerio.load(text, { xmlMode: true });
    return $("item").map((_, el) => ({
      title: $(el).find("title").text(),
      link: $(el).find("link").text(),
    })).get();
  } catch (err) {
    console.warn("Yahoo Finance fetch failed", err.message);
    return [];
  }
}

// 🔹 Apple Music Top Songs (Vietnam)
async function fetchAppleMusic() {
  try {
    const res = await fetch("https://rss.applemarketingtools.com/api/v2/vn/music/most-played/10/songs.json");
    const data = await res.json();
    return data.feed.results.map(item => ({
      title: item.name + " - " + item.artistName,
      link: item.url,
    }));
  } catch (err) {
    console.warn("Apple Music fetch failed", err.message);
    return [];
  }
}

// 🔹 Variety (Media)
async function fetchVariety() {
  try {
    const res = await fetch("https://variety.com/feed/");
    const text = await res.text();
    const $ = cheerio.load(text, { xmlMode: true });
    return $("item").map((_, el) => ({
      title: $(el).find("title").text(),
      link: $(el).find("link").text(),
    })).get();
  } catch (err) {
    console.warn("Variety fetch failed", err.message);
    return [];
  }
}

// 🔹 IGN Gaming
async function fetchIGNGaming() {
  try {
    const res = await fetch("https://feeds.ign.com/ign/games-all");
    const text = await res.text();
    const $ = cheerio.load(text, { xmlMode: true });
    return $("item").map((_, el) => ({
      title: $(el).find("title").text(),
      link: $(el).find("link").text(),
    })).get();
  } catch (err) {
    console.warn("IGN fetch failed", err.message);
    return [];
  }
}

// 🔹 VentureBeat AI
async function fetchVentureBeatAI() {
  try {
    const res = await fetch("https://venturebeat.com/category/ai/feed/");
    const text = await res.text();
    const $ = cheerio.load(text, { xmlMode: true });
    return $("item").map((_, el) => ({
      title: $(el).find("title").text(),
      link: $(el).find("link").text(),
    })).get();
  } catch (err) {
    console.warn("VentureBeat AI fetch failed", err.message);
    return [];
  }
}

// 🔹 Reddit Trends (free API)
async function fetchRedditTrends() {
  try {
    const res = await fetch("https://api.pullpush.io/reddit/search/submission/?q=trending&size=10");
    const data = await res.json();
    return data.data.map(i => ({ title: i.title, link: "https://reddit.com" + i.permalink }));
  } catch (e) {
    console.warn("Reddit fetch failed", e.message);
    return [];
  }
}

// 🔹 Twitter VN Trends (via Trends24 RSS)
async function fetchTwitterVN() {
  try {
    const res = await fetch("https://trends24.in/vietnam/feed/");
    const feed = await parser.parseString(await res.text());
    return feed.items.map(i => ({ title: i.title, link: i.link }));
  } catch (e) {
    console.warn("Twitter Vietnam trends fetch failed", e.message);
    return [];
  }
}
// 🔹 YouTube Trending VN
async function fetchYouTubeTrendingVN() {
  try {
    const res = await fetch("https://www.youtube.com/feeds/videos.xml?chart=mostPopular&regionCode=VN");
    const text = await res.text();
    const $ = cheerio.load(text, { xmlMode: true });
    return $("entry").map((_, el) => ({
      title: $(el).find("title").text(),
      link: $(el).find("link").attr("href"),
    })).get();
  } catch (err) {
    console.warn("YouTube VN trending fetch failed", err.message);
    return [];
  }
}

// ===============================
// 🚀 Netlify Function Handler
// ===============================
exports.handler = async function () {
  const [
    hackerNews,
    bbcWorld,
    vnexpress,
    yahooFinance,
    appleMusic,
    variety,
    ignGaming,
    ventureBeatAI,
    redditTrends,
    twitterVN,
    youtubeVN,
  ] = await Promise.all([
    fetchHackerNews(),
    fetchBBCWorld(),
    fetchVnExpress(),
    fetchYahooFinance(),
    fetchAppleMusic(),
    fetchVariety(),
    fetchIGNGaming(),
    fetchVentureBeatAI(),
    fetchRedditTrends(),
    fetchTwitterVietnam(),
    fetchYouTubeTrendingVN(),
  ]);

  return {
    statusCode: 200,
    body: JSON.stringify({
      tech: hackerNews,
      world: bbcWorld,
      news: vnexpress,
      finance: yahooFinance,
      music: appleMusic,
      media: variety,
      gaming: ignGaming,
      ai: ventureBeatAI,
      reddit: redditTrends,
      twitter_vn: twitterVN,
      youtube_vn: youtubeVN,
    }),
  };
};
