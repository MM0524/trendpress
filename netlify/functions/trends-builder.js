const Parser = require("rss-parser");
const googleTrends = require("google-trends-api");

const parser = new Parser();

// Utility: fetch with timeout
async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 8000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(id);
  }
}

// Normalize RSS item
function normalizeRssItem(item) {
  const baseVotes = Math.floor(Math.random() * 500) + 50;
  return {
    title: item.title,
    url: item.link,
    source: item.creator || item.author || "RSS",
    category: "general",
    publishedAt: item.isoDate || new Date().toISOString(),
    interactions: baseVotes,
    views: Math.floor(baseVotes * (Math.random() * 2 + 3)),
    searches: Math.floor(baseVotes * (Math.random() * 1.5 + 1)),
  };
}

// Normalize NewsAPI
function normalizeNewsApiArticle(article) {
  const baseVotes = Math.floor(Math.random() * 500) + 50;
  return {
    title: article.title,
    url: article.url,
    source: article.source.name,
    category: article.category || "general",
    publishedAt: article.publishedAt || new Date().toISOString(),
    interactions: baseVotes,
    views: Math.floor(baseVotes * (Math.random() * 2 + 3)),
    searches: Math.floor(baseVotes * (Math.random() * 1.5 + 1)),
  };
}

// Normalize Google Trends
function normalizeGoogleTrend(item, region) {
  const baseVotes = Math.floor(Math.random() * 1000) + 200;
  return {
    title: item.title.query,
    url:
      item.articles?.[0]?.url ||
      `https://www.google.com/search?q=${encodeURIComponent(item.title.query)}`,
    source: "Google Trends",
    category: "general",
    publishedAt: new Date().toISOString(),
    interactions: baseVotes,
    views: Math.floor(baseVotes * (Math.random() * 2 + 3)),
    searches: Math.floor(baseVotes * (Math.random() * 1.5 + 1)),
    region,
  };
}

// Hotness score
function calculateHotnessScore(trend, maxValues) {
  const weights = { views: 0.3, interactions: 0.4, searches: 0.3 };
  const normViews = (trend.views / maxValues.views) || 0;
  const normInteractions = (trend.interactions / maxValues.interactions) || 0;
  const normSearches = (trend.searches / maxValues.searches) || 0;
  return (
    normViews * weights.views +
    normInteractions * weights.interactions +
    normSearches * weights.searches
  );
}

// Fetch NewsAPI
async function fetchNewsApiTrends() {
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) {
    console.warn("⚠️ NEWSAPI_KEY is missing");
    return [];
  }

  const categories = [
    "technology",
    "general",
    "entertainment",
    "business",
    "sports",
    "health",
    "science",
  ];

  let allArticles = [];
  for (const category of categories) {
    try {
      const url = `https://newsapi.org/v2/top-headlines?country=us&category=${category}&apiKey=${apiKey}`;
      const res = await fetchWithTimeout(url, { timeout: 8000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const normalized = data.articles.map((a) =>
        normalizeNewsApiArticle({ ...a, category })
      );
      console.log(`✅ NewsAPI fetched: ${normalized.length} for ${category}`);
      allArticles = [...allArticles, ...normalized];
    } catch (err) {
      console.error(`❌ NewsAPI error [${category}]:`, err.message);
    }
  }
  return allArticles;
}

// Fetch RSS
async function fetchRssTrends() {
  const rssFeeds = [
    "https://vnexpress.net/rss/tin-moi-nhat.rss",
    "https://e.vnexpress.net/rss/news.rss",
    "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    "https://www.theguardian.com/world/rss",
  ];

  let allItems = [];
  for (const feed of rssFeeds) {
    try {
      const parsed = await parser.parseURL(feed);
      const normalized = parsed.items.map(normalizeRssItem);
      console.log(`✅ RSS fetched: ${normalized.length} from ${feed}`);
      allItems = [...allItems, ...normalized];
    } catch (err) {
      console.error(`❌ RSS Error for ${feed}:`, err.message);
    }
  }
  return allItems;
}

// Fetch Google Trends (Global + VN)
async function fetchGoogleTrends() {
  let globalTrends = [];
  let vnTrends = [];

  try {
    const dailyGlobal = await googleTrends.dailyTrends({ geo: "US" });
    try {
      const parsed = JSON.parse(dailyGlobal);
      globalTrends =
        parsed.default.trendingSearchesDays?.flatMap((d) => d.trendingSearches) ||
        [];
      globalTrends = globalTrends.map((t) => normalizeGoogleTrend(t, "Global"));
    } catch (parseErr) {
      console.error(
        "❌ Failed to parse Google Trends (Global):",
        dailyGlobal.slice(0, 200)
      );
    }
  } catch (err) {
    console.error("❌ Google Trends API error (Global):", err.message);
  }

  try {
    const dailyVN = await googleTrends.dailyTrends({ geo: "VN" });
    try {
      const parsed = JSON.parse(dailyVN);
      vnTrends =
        parsed.default.trendingSearchesDays?.flatMap((d) => d.trendingSearches) ||
        [];
      vnTrends = vnTrends.map((t) => normalizeGoogleTrend(t, "VN"));
    } catch (parseErr) {
      console.error(
        "❌ Failed to parse Google Trends (VN):",
        dailyVN.slice(0, 200)
      );
    }
  } catch (err) {
    console.error("❌ Google Trends API error (VN):", err.message);
  }

  return [...globalTrends, ...vnTrends];
}

// Main handler
module.exports.handler = async function (event, context) {
  try {
    console.log("🚀 Fetching NewsAPI...");
    const newsTrends = await fetchNewsApiTrends();

    console.log("🚀 Fetching RSS...");
    const rssTrends = await fetchRssTrends();

    console.log("🚀 Fetching Google Trends...");
    const googleTrendsData = await fetchGoogleTrends();

    // Merge tất cả
    const allTrends = [...newsTrends, ...rssTrends, ...googleTrendsData];

    // Tính max values
    const maxValues = {
      views: Math.max(...allTrends.map((t) => t.views), 1),
      interactions: Math.max(...allTrends.map((t) => t.interactions), 1),
      searches: Math.max(...allTrends.map((t) => t.searches), 1),
    };

    // Thêm hotnessScore
    const enrichedTrends = allTrends.map((t) => ({
      ...t,
      hotnessScore: calculateHotnessScore(t, maxValues),
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({ trends: enrichedTrends }),
    };
  } catch (err) {
    console.error("❌ Fatal error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
