// File: netlify/functions/fetch-trends.js
const fetch = require("node-fetch");

// ===== Helpers =====
async function fetchWithTimeout(url, options = {}, ms = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (TrendsBot/1.0)",
        ...(options.headers || {}),
      },
    });
    return res;
  } catch (err) {
    throw new Error(`Timeout or network error for ${url}: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtmlEntities(str = "") {
  return str
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function getTag(block, tag) {
  const cdata = new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]><\\/${tag}>`, "is");
  const plain = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(cdata) || block.match(plain);
  return m ? decodeHtmlEntities(m[1].trim()) : "";
}

function rssItems(xml) {
  const items = [];
  const reg = /<item[\s\S]*?>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = reg.exec(xml))) items.push(m[1]);
  return items;
}

// ---- Date helpers (FIX) ----
function toDateStr(d) {
  const dt = d ? new Date(d) : new Date();
  return isNaN(dt.getTime())
    ? new Date().toISOString().split("T")[0]
    : dt.toISOString().split("T")[0]; // YYYY-MM-DD
}

function toSortValue(d) {
  // dùng để sort theo thời gian gốc; fallback = 0 để xuống cuối
  const dt = d ? new Date(d) : null;
  return dt && !isNaN(dt.getTime()) ? dt.getTime() : 0;
}

// ===== Sources =====

// Hacker News
async function fetchHackerNewsFrontpage() {
  const res = await fetchWithTimeout("https://hnrss.org/frontpage");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => {
    const pub = getTag(block, "pubDate");
    return {
      title: getTag(block, "title"),
      description: getTag(block, "description"),
      category: "Tech",
      tags: ["HackerNews"],
      votes: 0,
      source: getTag(block, "link"),
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "Hacker News",
    };
  });
}

// The Verge
async function fetchTheVerge() {
  const res = await fetchWithTimeout("https://www.theverge.com/rss/index.xml");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => {
    const pub = getTag(block, "pubDate");
    return {
      title: getTag(block, "title"),
      description: getTag(block, "description"),
      category: "Tech",
      tags: ["TheVerge"],
      votes: 0,
      source: getTag(block, "link"),
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "The Verge",
    };
  });
}

// IGN Gaming
async function fetchIGNGaming() {
  const res = await fetchWithTimeout("https://feeds.ign.com/ign/games-all");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => {
    const pub = getTag(block, "pubDate");
    return {
      title: getTag(block, "title"),
      description: getTag(block, "description"),
      category: "Gaming",
      tags: ["IGN", "Games"],
      votes: 0,
      source: getTag(block, "link"),
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "IGN",
    };
  });
}

// VentureBeat AI
async function fetchVentureBeatAI() {
  const res = await fetchWithTimeout("https://venturebeat.com/category/ai/feed/");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => {
    const pub = getTag(block, "pubDate");
    return {
      title: getTag(block, "title"),
      description: getTag(block, "description"),
      category: "AI",
      tags: ["VentureBeat", "AI"],
      votes: 0,
      source: getTag(block, "link"),
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "VentureBeat",
    };
  });
}

// MIT Technology Review (AI tag)
async function fetchMITTech() {
  const res = await fetchWithTimeout(
    "https://www.technologyreview.com/feed/tag/artificial-intelligence/"
  );
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => {
    const pub = getTag(block, "pubDate");
    return {
      title: getTag(block, "title"),
      description: getTag(block, "description"),
      category: "AI",
      tags: ["MITTechReview", "AI"],
      votes: 0,
      source: getTag(block, "link"),
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "MIT Tech Review",
    };
  });
}

// Google News VIETNAM
async function fetchGoogleNewsVN() {
  const res = await fetchWithTimeout(
    "https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi"
  );
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => {
    const pub = getTag(block, "pubDate");
    return {
      title: getTag(block, "title"),
      description: getTag(block, "description"),
      category: "News",
      tags: ["GoogleNewsVN", "Vietnam"],
      votes: 0,
      source: getTag(block, "link"),
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "Google News VN",
    };
  });
}

// BBC World News
async function fetchBBCWorld() {
  const res = await fetchWithTimeout("https://feeds.bbci.co.uk/news/world/rss.xml");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => {
    const pub = getTag(block, "pubDate");
    return {
      title: getTag(block, "title"),
      description: getTag(block, "description"),
      category: "News",
      tags: ["BBC", "WorldNews"],
      votes: 0,
      source: getTag(block, "link"),
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "BBC World News",
    };
  });
}

// Yahoo Finance
async function fetchYahooFinance() {
  const res = await fetchWithTimeout("https://finance.yahoo.com/rss/topstories");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => {
    const pub = getTag(block, "pubDate");
    return {
      title: getTag(block, "title"),
      description: getTag(block, "description"),
      category: "Finance",
      tags: ["YahooFinance"],
      votes: 0,
      source: getTag(block, "link"),
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "Yahoo Finance",
    };
  });
}

// CNBC Finance
async function fetchCNBCFinance() {
  const res = await fetchWithTimeout(
    "https://www.cnbc.com/id/10000664/device/rss/rss.html"
  );
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => {
    const pub = getTag(block, "pubDate");
    return {
      title: getTag(block, "title"),
      description: getTag(block, "description"),
      category: "Finance",
      tags: ["CNBC", "Markets"],
      votes: 0,
      source: getTag(block, "link"),
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "CNBC",
    };
  });
}

// Science Magazine (AAAS) – News
async function fetchScienceMagazine() {
  const res = await fetchWithTimeout("https://www.science.org/rss/news_current.xml");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => {
    const pub = getTag(block, "pubDate");
    return {
      title: getTag(block, "title"),
      description: getTag(block, "description"),
      category: "Science",
      tags: ["ScienceMag"],
      votes: 0,
      source: getTag(block, "link"),
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "Science Magazine",
    };
  });
}

// New Scientist
async function fetchNewScientist() {
  const res = await fetchWithTimeout("https://www.newscientist.com/feed/home/");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => {
    const pub = getTag(block, "pubDate");
    return {
      title: getTag(block, "title"),
      description: getTag(block, "description"),
      category: "Science",
      tags: ["NewScientist"],
      votes: 0,
      source: getTag(block, "link"),
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "New Scientist",
    };
  });
}

// Apple Music VN – Most Played
async function fetchAppleMusicMostPlayedVN() {
  const res = await fetchWithTimeout(
    "https://rss.applemarketingtools.com/api/v2/vn/music/most-played/100/songs.json"
  );
  if (!res.ok) return [];
  const json = await res.json();
  return json.feed.results.map((item, i) => {
    const pub = item.releaseDate || new Date().toISOString();
    return {
      title: item.name,
      description: item.artistName,
      category: "Music",
      tags: ["AppleMusic", "Vietnam", "MostPlayed"],
      votes: 0,
      source: item.url,
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "Apple Music",
    };
  });
}

// Apple Music VN – New Releases
async function fetchAppleMusicNewReleasesVN() {
  const res = await fetchWithTimeout(
    "https://rss.applemarketingtools.com/api/v2/vn/music/new-releases/100/songs.json"
  );
  if (!res.ok) return [];
  const json = await res.json();
  return json.feed.results.map((item, i) => {
    const pub = item.releaseDate || new Date().toISOString();
    return {
      title: item.name,
      description: item.artistName,
      category: "Music",
      tags: ["AppleMusic", "Vietnam", "NewReleases"],
      votes: 0,
      source: item.url,
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "Apple Music",
    };
  });
}

// ================== Entertainment Sources ==================

// YouTube Trending Việt Nam
async function fetchYouTubeTrendingVN() {
  const res = await fetchWithTimeout(
    "https://rsshub.app/youtube/trending/region/VN"
  );
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Media",
    tags: ["YouTube", "Trending", "VN"],
    votes: 0,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "YouTube Trending VN",
  }));
}

// Variety (Entertainment Global)
async function fetchVariety() {
  const res = await fetchWithTimeout("https://variety.com/feed/");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => {
    const pub = getTag(block, "pubDate");
    return {
      title: getTag(block, "title"),
      description: getTag(block, "description"),
      category: "Entertainment",
      tags: ["Variety", "Global"],
      votes: 0,
      source: getTag(block, "link"),
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "Variety",
    };
  });
}

// Deadline (Hollywood Entertainment)
async function fetchDeadline() {
  const res = await fetchWithTimeout("https://deadline.com/feed/");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => {
    const pub = getTag(block, "pubDate");
    return {
      title: getTag(block, "title"),
      description: getTag(block, "description"),
      category: "Entertainment",
      tags: ["Deadline", "Showbiz", "Hollywood"],
      votes: 0,
      source: getTag(block, "link"),
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "Deadline",
    };
  });
}

// Kênh14 (Vietnam Entertainment)
async function fetchKenh14() {
  const res = await fetchWithTimeout("https://kenh14.vn/giai-tri.rss");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => {
    const pub = getTag(block, "pubDate");
    return {
      title: getTag(block, "title"),
      description: getTag(block, "description"),
      category: "Entertainment",
      tags: ["Kenh14", "Vietnam"],
      votes: 0,
      source: getTag(block, "link"),
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "Kênh14",
    };
  });
}

// Zing News (Vietnam Entertainment)
async function fetchZingNewsEntertainment() {
  const res = await fetchWithTimeout("https://zingnews.vn/rss/giai-tri.rss");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => {
    const pub = getTag(block, "pubDate");
    return {
      title: getTag(block, "title"),
      description: getTag(block, "description"),
      category: "Entertainment",
      tags: ["ZingNews", "Vietnam"],
      votes: 0,
      source: getTag(block, "link"),
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "Zing News",
    };
  });
}

// ESPN World Sports
async function fetchESPN() {
  const res = await fetchWithTimeout("https://www.espn.com/espn/rss/news");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => {
    const pub = getTag(block, "pubDate");
    return {
      title: getTag(block, "title"),
      description: getTag(block, "description"),
      category: "Sports",
      tags: ["ESPN", "WorldSports"],
      votes: 0,
      source: getTag(block, "link"),
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "ESPN",
    };
  });
}

// Logistics
async function fetchLogistics() {
  const res = await fetchWithTimeout("https://www.freightwaves.com/feed");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => {
    const pub = getTag(block, "pubDate");
    return {
      title: getTag(block, "title"),
      description: getTag(block, "description"),
      category: "Logistics",
      tags: ["Logistics", "SupplyChain"],
      votes: 0,
      source: getTag(block, "link"),
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "FreightWaves",
    };
  });
}

// Cybernews
async function fetchCybernews() {
  const res = await fetchWithTimeout("https://cybernews.com/feed/");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => {
    const pub = getTag(block, "pubDate");
    return {
      title: getTag(block, "title"),
      description: getTag(block, "description"),
      category: "Cybersecurity",
      tags: ["Cybernews", "Security"],
      votes: 0,
      source: getTag(block, "link"),
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "Cybernews",
    };
  });
}

// Healthcare
async function fetchHealthcare() {
  const res = await fetchWithTimeout("https://www.medicalnewstoday.com/rss");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => {
    const pub = getTag(block, "pubDate");
    return {
      title: getTag(block, "title"),
      description: getTag(block, "description"),
      category: "Healthcare",
      tags: ["MedicalNewsToday", "Health"],
      votes: 0,
      source: getTag(block, "link"),
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "Medical News Today",
    };
  });
}

// Education
async function fetchEducation() {
  const res = await fetchWithTimeout("https://www.chronicle.com/section/News/6/feed");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => {
    const pub = getTag(block, "pubDate");
    return {
      title: getTag(block, "title"),
      description: getTag(block, "description"),
      category: "Education",
      tags: ["Chronicle", "Education"],
      votes: 0,
      source: getTag(block, "link"),
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "The Chronicle of Higher Education",
    };
  });
}

// Environment
async function fetchEnvironment() {
  const res = await fetchWithTimeout("https://www.nationalgeographic.com/environment/rss");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => {
    const pub = getTag(block, "pubDate");
    return {
      title: getTag(block, "title"),
      description: getTag(block, "description"),
      category: "Environment",
      tags: ["NationalGeographic", "Environment"],
      votes: 0,
      source: getTag(block, "link"),
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "National Geographic",
    };
  });
}

// Politics (Reuters)
async function fetchPolitics() {
  const res = await fetchWithTimeout("https://feeds.reuters.com/Reuters/worldNews");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => {
    const pub = getTag(block, "pubDate");
    return {
      title: getTag(block, "title"),
      description: getTag(block, "description"),
      category: "Politics",
      tags: ["Reuters", "Politics"],
      votes: 0,
      source: getTag(block, "link"),
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "Reuters World News",
    };
  });
}

// Travel
async function fetchTravel() {
  const res = await fetchWithTimeout("https://www.lonelyplanet.com/news/rss");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block) => {
    const pub = getTag(block, "pubDate");
    return {
      title: getTag(block, "title"),
      description: getTag(block, "description"),
      category: "Travel",
      tags: ["LonelyPlanet", "Travel"],
      votes: 0,
      source: getTag(block, "link"),
      date: toDateStr(pub),
      sortKey: toSortValue(pub),
      submitter: "Lonely Planet",
    };
  });
}

// ===== Netlify Function Handler =====
exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        ...headers,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    };
  }

  try {
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
      fetchKenh14(),
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

    const results = await Promise.allSettled(sources);

    let trends = [];
    for (const r of results) {
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        trends.push(...r.value);
      } else if (r.status === "rejected") {
        console.warn("A source failed to fetch:", r.reason?.message || r.reason);
      }
    }

    if (trends.length === 0) {
      throw new Error("All data sources failed to respond in time.");
    }

    trends = trends
      .filter(Boolean)
      .sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0)) // newest first
      .map((t, i) => {
        const { sortKey, ...rest } = t; // không trả sortKey ra ngoài
        return { ...rest, id: i + 1 };
      });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, trends }),
    };
  } catch (err) {
    console.error("fetch-trends handler error", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: "Failed to fetch live trends",
        message: err.message,
      }),
    };
  }
};
