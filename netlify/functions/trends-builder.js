const crypto = require("crypto");

// =========================
// Helpers
// =========================
async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 10000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(resource, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    console.error("❌ Fetch error:", resource, err.message);
    throw err;
  }
}

function createStandardTrend(item, sourceName, defaultCategory, defaultRegion, extraTags = []) {
  const title = item.title || "";
  const link = item.link || item.url || "";
  const description = item.description || item.content || "";
  const pubDate = item.pubDate || new Date().toISOString();
  const id = crypto.createHash("md5").update(link + title).digest("hex");

  return {
    id,
    title,
    description,
    link,
    pubDate,
    source: sourceName,
    category: defaultCategory,
    region: defaultRegion,
    tags: extraTags,
    votes: Math.floor(Math.random() * 1000),
    views: Math.floor(Math.random() * 5000),
    interactions: Math.floor(Math.random() * 800),
    searches: Math.floor(Math.random() * 2000),
  };
}

async function fetchGoogleTrendsRss(url, sourceName, defaultRegion) {
  try {
    const res = await fetchWithTimeout(url);
    const xml = await res.text();

    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(match => {
      const block = match[1];
      const get = (tag) => {
        const m = block.match(new RegExp(`<${tag}>(.*?)</${tag}>`, "s"));
        return m ? m[1].trim() : "";
      };
      return {
        title: get("title"),
        link: get("link"),
        description: get("description"),
        pubDate: get("pubDate"),
      };
    });

    return items.map(item => createStandardTrend(item, sourceName, "Trends", defaultRegion, ["GoogleTrends"]));
  } catch (err) {
    console.error(`❌ Google Trends error ${sourceName}:`, err.message);
    return [];
  }
}

async function fetchNewsApi(url, sourceName, defaultRegion) {
  try {
    const res = await fetchWithTimeout(url);
    const json = await res.json();
    if (!json.articles) return [];

    return json.articles.map(item => createStandardTrend(item, sourceName, "News", defaultRegion, ["NewsAPI"]));
  } catch (err) {
    console.error(`❌ NewsAPI error ${sourceName}:`, err.message);
    return [];
  }
}

function calculateHotnessScore(trend, maxValues) {
  const { views, interactions, searches, votes } = trend;
  return (
    (views / (maxValues.views || 1)) * 0.4 +
    (interactions / (maxValues.interactions || 1)) * 0.3 +
    (searches / (maxValues.searches || 1)) * 0.2 +
    (votes / (maxValues.votes || 1)) * 0.1
  );
}

// =========================
// Fetchers
// =========================
const fetchers = [
  // Google Trends VN & US
  () => fetchGoogleTrendsRss("https://trends.google.com/trends/trendingsearches/daily/rss?geo=VN", "Google Trends VN", "vn"),
  () => fetchGoogleTrendsRss("https://trends.google.com/trends/trendingsearches/daily/rss?geo=US", "Google Trends US", "us"),

  // NewsAPI (cần NEWSAPI_KEY trong Netlify env)
  () => fetchNewsApi(`https://newsapi.org/v2/top-headlines?country=vn&apiKey=${process.env.NEWSAPI_KEY}`, "NewsAPI VN", "vn"),
  () => fetchNewsApi(`https://newsapi.org/v2/top-headlines?country=us&apiKey=${process.env.NEWSAPI_KEY}`, "NewsAPI US", "us"),
];

// =========================
// Handler
// =========================
exports.handler = async () => {
  try {
    const results = (await Promise.allSettled(fetchers.map(fn => fn())))
      .flatMap(r => (r.status === "fulfilled" ? r.value : []));

    if (results.length === 0) {
      throw new Error("No trends fetched. Check NEWSAPI_KEY or feeds.");
    }

    const maxValues = results.reduce(
      (acc, t) => {
        acc.views = Math.max(acc.views, t.views || 0);
        acc.interactions = Math.max(acc.interactions, t.interactions || 0);
        acc.searches = Math.max(acc.searches, t.searches || 0);
        acc.votes = Math.max(acc.votes, t.votes || 0);
        return acc;
      },
      { views: 0, interactions: 0, searches: 0, votes: 0 }
    );

    const withScores = results.map((t) => ({
      ...t,
      hotness: calculateHotnessScore(t, maxValues),
    }));

    return {
      statusCode: 200,
      body: JSON.stringify(
        { success: true, count: withScores.length, trends: withScores },
        null,
        2
      ),
    };
  } catch (err) {
    console.error("❌ Handler error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: "Failed to fetch trends",
        message: err.message,
      }),
    };
  }
};
