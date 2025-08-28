// File: netlify/functions/fetch-trends.js
const fetch = require("node-fetch");
const Parser = require("rss-parser");
const parser = new Parser();

// ===== Helpers =====
async function fetchWithTimeout(url, options = {}, ms = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);

  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; TrendFetcher/1.0; +http://yourapp.com)",
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

function createTrendFromRssItem(item, category, region, source) {
  return {
    id: item.link || item.guid || Date.now(),
    title: item.title || "No title",
    url: item.link,
    excerpt: item.contentSnippet || item.summary || "",
    date: item.isoDate || item.pubDate || new Date().toISOString(),
    category,
    region,
    source,
  };
}

function preprocessTrends(trends) {
  return trends.filter(Boolean).slice(0, 50);
}

// ===== Sources =====

// Hacker News
async function fetchHackerNewsFrontpage() {
  try {
    const res = await fetchWithTimeout("https://hnrss.org/frontpage");
    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items.map((i) =>
      createTrendFromRssItem(i, "Tech", "global", "Hacker News")
    );
  } catch {
    return [];
  }
}

// The Verge
async function fetchTheVerge() {
  try {
    const res = await fetchWithTimeout("https://www.theverge.com/rss/index.xml");
    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items.map((i) =>
      createTrendFromRssItem(i, "Tech", "global", "The Verge")
    );
  } catch {
    return [];
  }
}

// IGN Gaming
async function fetchIGNGaming() {
  try {
    const res = await fetchWithTimeout("https://feeds.ign.com/ign/games-all");
    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items.map((i) =>
      createTrendFromRssItem(i, "Gaming", "global", "IGN Gaming")
    );
  } catch {
    return [];
  }
}

// VentureBeat (AI)
async function fetchVentureBeatAI() {
  try {
    const res = await fetchWithTimeout("https://venturebeat.com/feed/");
    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items
      .filter((i) => /AI|Artificial Intelligence/i.test(i.title))
      .map((i) =>
        createTrendFromRssItem(i, "AI", "global", "VentureBeat AI")
      );
  } catch {
    return [];
  }
}

// MIT Tech Review
async function fetchMITTech() {
  try {
    const res = await fetchWithTimeout("https://www.technologyreview.com/feed/");
    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items.map((i) =>
      createTrendFromRssItem(i, "Tech", "global", "MIT Tech Review")
    );
  } catch {
    return [];
  }
}

// Google News VN
async function fetchGoogleNewsVN() {
  try {
    const res = await fetchWithTimeout(
      "https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi"
    );
    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items.map((i) =>
      createTrendFromRssItem(i, "News", "vn", "Google News VN")
    );
  } catch {
    return [];
  }
}

// Yahoo Finance
async function fetchYahooFinance() {
  try {
    const res = await fetchWithTimeout("https://finance.yahoo.com/news/rssindex");
    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items.map((i) =>
      createTrendFromRssItem(i, "Finance", "global", "Yahoo Finance")
    );
  } catch {
    return [];
  }
}

// CNBC Finance
async function fetchCNBCFinance() {
  try {
    const res = await fetchWithTimeout("https://www.cnbc.com/id/10000664/device/rss/rss.html");
    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items.map((i) =>
      createTrendFromRssItem(i, "Finance", "global", "CNBC Finance")
    );
  } catch {
    return [];
  }
}

// Science Magazine
async function fetchScienceMagazine() {
  try {
    const res = await fetchWithTimeout("https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=science");
    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items.map((i) =>
      createTrendFromRssItem(i, "Science", "global", "Science Magazine")
    );
  } catch {
    return [];
  }
}

// New Scientist
async function fetchNewScientist() {
  try {
    const res = await fetchWithTimeout("https://www.newscientist.com/feed/home/");
    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items.map((i) =>
      createTrendFromRssItem(i, "Science", "global", "New Scientist")
    );
  } catch {
    return [];
  }
}

// Apple Music Most Played VN
async function fetchAppleMusicMostPlayedVN() {
  try {
    const res = await fetchWithTimeout("https://itunes.apple.com/vn/rss/topsongs/limit=50/json");
    const data = await res.json();
    return data.feed.entry.map((entry) => ({
      id: entry.id.label,
      title: entry["im:name"].label,
      url: entry.id.label,
      excerpt: entry["im:artist"].label,
      date: new Date().toISOString(),
      category: "Music",
      region: "vn",
      source: "Apple Music VN - Most Played",
    }));
  } catch {
    return [];
  }
}

// Apple Music New Releases VN
async function fetchAppleMusicNewReleasesVN() {
  try {
    const res = await fetchWithTimeout("https://itunes.apple.com/vn/rss/newmusic/limit=50/json");
    const data = await res.json();
    return data.feed.entry.map((entry) => ({
      id: entry.id.label,
      title: entry["im:name"].label,
      url: entry.id.label,
      excerpt: entry["im:artist"].label,
      date: new Date().toISOString(),
      category: "Music",
      region: "vn",
      source: "Apple Music VN - New Releases",
    }));
  } catch {
    return [];
  }
}

// YouTube Trending VN (placeholder, cần API key)
async function fetchYouTubeTrendingVN() {
  return [];
}

// Variety
async function fetchVariety() {
  try {
    const res = await fetchWithTimeout("https://variety.com/feed/");
    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items.map((i) =>
      createTrendFromRssItem(i, "Media", "global", "Variety")
    );
  } catch {
    return [];
  }
}

// Deadline
async function fetchDeadline() {
  try {
    const res = await fetchWithTimeout("https://deadline.com/feed/");
    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items.map((i) =>
      createTrendFromRssItem(i, "Media", "global", "Deadline")
    );
  } catch {
    return [];
  }
}

// GameK.vn
async function fetchGameKVN() {
  try {
    const res = await fetchWithTimeout("https://gamek.vn/rss.chn");
    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items.map((i) =>
      createTrendFromRssItem(i, "Gaming", "vn", "GameK.vn")
    );
  } catch {
    return [];
  }
}

// Zing News (Entertainment)
async function fetchZingNewsEntertainment() {
  try {
    const res = await fetchWithTimeout("https://zingnews.vn/rss/giai-tri.rss");
    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items.map((i) =>
      createTrendFromRssItem(i, "Media", "vn", "Zing News Entertainment")
    );
  } catch {
    return [];
  }
}

// BBC World
async function fetchBBCWorld() {
  try {
    const res = await fetchWithTimeout("http://feeds.bbci.co.uk/news/world/rss.xml");
    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items.map((i) =>
      createTrendFromRssItem(i, "News", "global", "BBC World")
    );
  } catch {
    return [];
  }
}

// ESPN
async function fetchESPN() {
  try {
    const res = await fetchWithTimeout("https://www.espn.com/espn/rss/news");
    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items.map((i) =>
      createTrendFromRssItem(i, "Sports", "global", "ESPN")
    );
  } catch {
    return [];
  }
}

// Logistics (placeholder → Supply Chain Digital)
async function fetchLogistics() {
  try {
    const res = await fetchWithTimeout("https://supplychaindigital.com/rss");
    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items.map((i) =>
      createTrendFromRssItem(i, "Logistics", "global", "Supply Chain Digital")
    );
  } catch {
    return [];
  }
}

// Cybernews
async function fetchCybernews() {
  try {
    const res = await fetchWithTimeout("https://cybernews.com/feed/");
    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items.map((i) =>
      createTrendFromRssItem(i, "Tech", "global", "Cybernews")
    );
  } catch {
    return [];
  }
}

// Healthcare
async function fetchHealthcare() {
  try {
    const res = await fetchWithTimeout("https://www.medicalnewstoday.com/rss");
    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items.map((i) =>
      createTrendFromRssItem(i, "Health", "global", "Medical News Today")
    );
  } catch {
    return [];
  }
}

// Education (Edutopia RSS)
async function fetchEducation() {
  try {
    const res = await fetchWithTimeout("https://www.edutopia.org/rss.xml");
    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items.map((i) =>
      createTrendFromRssItem(i, "Education", "global", "Edutopia")
    );
  } catch {
    return [];
  }
}

// Environment (NatGeo)
async function fetchEnvironment() {
  try {
    const res = await fetchWithTimeout("https://www.nationalgeographic.com/expeditions/rss");
    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items.map((i) =>
      createTrendFromRssItem(i, "Environment", "global", "National Geographic")
    );
  } catch {
    return [];
  }
}

// Politics (Reuters)
async function fetchPolitics() {
  try {
    const res = await fetchWithTimeout("https://feeds.reuters.com/Reuters/PoliticsNews");
    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items.map((i) =>
      createTrendFromRssItem(i, "Politics", "global", "Reuters Politics")
    );
  } catch {
    return [];
  }
}

// Travel (Travel + Leisure)
async function fetchTravel() {
  try {
    const res = await fetchWithTimeout("https://www.travelandleisure.com/rss");
    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items.map((i) =>
      createTrendFromRssItem(i, "Travel", "global", "Travel + Leisure")
    );
  } catch {
    return [];
  }
}

// ===== Handler =====
exports.handler = async function () {
  const sources = [
    fetchHackerNewsFrontpage(),
    fetchTheVerge(),
    fetchIGNGaming(),
    fetchVentureBeatAI(),
    fetchMITTech(),
    fetchGoogleNewsVN(),
    fetchYahooFinance(),
    fetchCNBCFinance(),
    fetchScienceMagazine(),
    fetchNewScientist(),
    fetchAppleMusicMostPlayedVN(),
    fetchAppleMusicNewReleasesVN(),
    fetchYouTubeTrendingVN(),
    fetchVariety(),
    fetchDeadline(),
    fetchGameKVN(),
    fetchZingNewsEntertainment(),
    fetchBBCWorld(),
    fetchESPN(),
    fetchLogistics(),
    fetchCybernews(),
    fetchHealthcare(),
    fetchEducation(),
    fetchEnvironment(),
    fetchPolitics(),
    fetchTravel(),
  ];

  let trends = [];
  await Promise.allSettled(sources).then((results) => {
    results.forEach((r) => {
      if (r.status === "fulfilled") {
        trends = trends.concat(r.value);
      } else {
        console.warn("A source failed:", r.reason?.message || r.reason);
      }
    });
  });

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      count: trends.length,
      trends: preprocessTrends(trends),
    }),
  };
};
