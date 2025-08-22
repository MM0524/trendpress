// File: netlify/functions/fetch-trends.js
const fetch = require('node-fetch');

// Helper: fetch với timeout để tránh bị treo
async function fetchWithTimeout(url, options = {}, ms = 7000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    // Ném lỗi để Promise.allSettled có thể bắt được
    throw new Error(`Timeout or network error for ${url}: ${err.message}`);
  }
}

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*", // Cho phép request từ bất kỳ đâu
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", ...headers }};
  }
  
  try {
    // TỐI ƯU: Giảm số lượng nguồn tin để đảm bảo chạy dưới 10 giây
    const sources = [
        fetchHackerNewsFrontpage(),
        fetchVnExpressInternational(),
        fetchTheVerge(),
        fetchTechCrunch(),
        fetchIGNGaming(),
        fetchGameSpot(),
        fetchVentureBeatAI(),
        fetchMITAIVN(),
        fetchGoogleNewsVN(),
        fetchYahooFinance(),
        fetchCNBCFinance(),
        fetchVariety(),
        fetchHollywoodReporter(),
        fetchWired(),
        fetchAppleMusicMostPlayedVN(),
        fetchAppleMusicNewReleasesVN(),
        fetchNatureScience(),
    ];

    // TỐI ƯU: Dùng Promise.allSettled để không bị thất bại hoàn toàn nếu một nguồn lỗi
    const results = await Promise.allSettled(sources);
    
    let allFetchedTrends = [];
    results.forEach(result => {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
            allFetchedTrends.push(...result.value);
        } else if (result.status === 'rejected') {
            console.warn("A source failed to fetch:", result.reason.message);
        }
    });

    if (allFetchedTrends.length === 0) {
        throw new Error("All data sources failed to respond in time.");
    }
    
    // Gộp & chuẩn hoá
    let trends = allFetchedTrends
      .filter(Boolean)
      .sort((a, b) => (b.votes || 0) - (a.votes || 0));

    // Gán id tăng dần
    trends = trends.map((t, i) => ({ ...t, id: i + 1 }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        trends,
      })
    };
  } catch (error) {
    console.error("fetch-trends handler error", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: "Failed to fetch live trends",
        message: error.message
      })
    };
  }
};

// ============ Helpers ============
function decodeHtmlEntities(str = "") { return str.replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">"); }
function getTag(block, tag) { const cdata = new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]><\\/${tag}>`, "is"); const plain = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"); let m = block.match(cdata) || block.match(plain); return m ? decodeHtmlEntities(m[1].trim()) : ""; }
function rssItems(xml, max = 8) { const items = []; const reg = /<item[\s\S]*?>([\s\S]*?)<\/item>/gi; let m; while ((m = reg.exec(xml)) && items.length < max) { items.push(m[1]); } return items; }
function toDateStr(d) { const dt = d ? new Date(d) : new Date(); return isNaN(dt.getTime()) ? new Date().toISOString().split('T')[0] : dt.toISOString().split('T')[0]; }

// ============ Sources (Lấy ít hơn để đảm bảo tốc độ) ============
async function fetchHackerNewsFrontpage() {
    const res = await fetchWithTimeout("https://hnrss.org/frontpage");
    if (!res.ok) return [];
    const xml = await res.text();
    return rssItems(xml).map((block, i) => ({ title: getTag(block, "title"), description: getTag(block, "description"), category: "Tech", tags: ["HackerNews"], votes: 500 - i, source: getTag(block, "link"), date: toDateStr(getTag(block, "pubDate")), submitter: "Hacker News" }));
}

async function fetchVnExpressInternational() {
    const res = await fetchWithTimeout("https://vnexpress.net/rss/tin-moi-nhat.rss");
    if (!res.ok) return [];
    const xml = await res.text();
    return rssItems(xml).map((block, i) => ({ title: getTag(block, "title"), description: getTag(block, "description"), category: "News", tags: ["VnExpress", "Vietnam"], votes: 450 - i, source: getTag(block, "link"), date: toDateStr(getTag(block, "pubDate")), submitter: "VnExpress" }));
}

async function fetchTheVerge() {
    const res = await fetchWithTimeout("https://www.theverge.com/rss/index.xml");
    if (!res.ok) return [];
    const xml = await res.text();
    return rssItems(xml).map((block, i) => ({ title: getTag(block, "title"), description: getTag(block, "description"), category: "Tech", tags: ["TheVerge"], votes: 400 - i, source: getTag(block, "link"), date: toDateStr(getTag(block, "pubDate")), submitter: "The Verge" }));
}

async function fetchTechCrunch() {
    const res = await fetchWithTimeout("https://techcrunch.com/feed/");
    if (!res.ok) return [];
    const xml = await res.text();
    return rssItems(xml).map((block, i) => ({ title: getTag(block, "title"), description: getTag(block, "description"), category: "Tech", tags: ["TechCrunch", "Startups"], votes: 380 - i, source: getTag(block, "link"), date: toDateStr(getTag(block, "pubDate")), submitter: "TechCrunch" }));
}

async function fetchIGNGaming() {
    const res = await fetchWithTimeout("https://feeds.ign.com/ign/games-all");
    if (!res.ok) return [];
    const xml = await res.text();
    return rssItems(xml).map((block, i) => ({ title: getTag(block, "title"), description: getTag(block, "description"), category: "Gaming", tags: ["IGN", "Games"], votes: 350 - i, source: getTag(block, "link"), date: toDateStr(getTag(block, "pubDate")), submitter: "IGN" }));
}

// GameSpot
async function fetchGameSpot() {
  const res = await fetchWithTimeout("https://www.gamespot.com/feeds/mashup/");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Gaming",
    tags: ["GameSpot"],
    votes: 430 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "GameSpot"
  }));
}

async function fetchVentureBeatAI() {
    const res = await fetchWithTimeout("https://venturebeat.com/category/ai/feed/");
    if (!res.ok) return [];
    const xml = await res.text();
    return rssItems(xml).map((block, i) => ({ title: getTag(block, "title"), description: getTag(block, "description"), category: "AI", tags: ["VentureBeat", "AI"], votes: 420 - i, source: getTag(block, "link"), date: toDateStr(getTag(block, "pubDate")), submitter: "VentureBeat" }));
}

// MIT Technology Review - AI
async function fetchMITAIVN() {
  const res = await fetchWithTimeout("https://www.technologyreview.com/feed/tag/artificial-intelligence/");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "AI",
    tags: ["MIT", "AI"],
    votes: 450 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "MIT Tech Review"
  }));
}

async function fetchGoogleNewsVN() {
    const res = await fetchWithTimeout("https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi");
    if (!res.ok) return [];
    const xml = await res.text();
    return rssItems(xml).map((block, i) => ({ title: getTag(block, "title"), description: getTag(block, "description"), category: "News", tags: ["GoogleNews", "Vietnam"], votes: 300 - i, source: getTag(block, "link"), date: toDateStr(getTag(block, "pubDate")), submitter: "Google News VN" }));
}

// 🔹 Yahoo Finance
async function fetchYahooFinance() {
    const res = await fetchWithTimeout("https://finance.yahoo.com/rss/topstories");
    if (!res.ok) return [];
    const xml = await res.text();
    return rssItems(xml).map((block, i) => ({
        title: getTag(block, "title"),
        description: getTag(block, "description"),
        category: "Finance",
        tags: ["YahooFinance"],
        votes: 500 - i,
        source: getTag(block, "link"),
        date: toDateStr(getTag(block, "pubDate")),
        submitter: "Yahoo Finance"
    }));
}

// CNBC Finance
async function fetchCNBCFinance() {
  const res = await fetchWithTimeout("https://www.cnbc.com/id/10000664/device/rss/rss.html");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Finance",
    tags: ["CNBC", "Markets"],
    votes: 440 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "CNBC"
  }));
}

// 🔹 Variety
async function fetchVariety() {
    const res = await fetchWithTimeout("https://variety.com/feed/");
    if (!res.ok) return [];
    const xml = await res.text();
    return rssItems(xml).map((block, i) => ({
        title: getTag(block, "title"),
        description: getTag(block, "description"),
        category: "Media",
        tags: ["Variety"],
        votes: 500 - i,
        source: getTag(block, "link"),
        date: toDateStr(getTag(block, "pubDate")),
        submitter: "Variety"
    }));
}

// Hollywood Reporter
async function fetchHollywoodReporter() {
  const res = await fetchWithTimeout("https://www.hollywoodreporter.com/t/feed/");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Media",
    tags: ["HollywoodReporter"],
    votes: 420 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "Hollywood Reporter"
  }));
}


// 🔹 Wired
async function fetchWired() {
    const res = await fetchWithTimeout("https://www.wired.com/feed/rss");
    if (!res.ok) return [];
    const xml = await res.text();
    return rssItems(xml).map((block, i) => ({
        title: getTag(block, "title"),
        description: getTag(block, "description"),
        category: "Tech",
        tags: ["Wired"],
        votes: 500 - i,
        source: getTag(block, "link"),
        date: toDateStr(getTag(block, "pubDate")),
        submitter: "Wired"
    }));
}

// 🔹 Apple Music Vietnam - Most Played
async function fetchAppleMusicMostPlayedVN() {
  const res = await fetchWithTimeout("https://rss.applemarketingtools.com/api/v2/vn/music/most-played/100/songs.json");
  if (!res.ok) return [];
  const json = await res.json();
  return json.feed.results.map((item, i) => ({
    title: item.name,
    description: item.artistName,
    category: "Music",
    tags: ["AppleMusic", "Vietnam", "MostPlayed"],
    votes: 500 - i,
    source: item.url,
    date: toDateStr(item.releaseDate || new Date().toISOString()),
    submitter: "Apple Music"
  }));
}

// 🔹 Apple Music Vietnam - New Releases
async function fetchAppleMusicNewReleasesVN() {
  const res = await fetchWithTimeout("https://rss.applemarketingtools.com/api/v2/vn/music/new-releases/100/songs.json");
  if (!res.ok) return [];
  const json = await res.json();
  return json.feed.results.map((item, i) => ({
    title: item.name,
    description: item.artistName,
    category: "Music",
    tags: ["AppleMusic", "Vietnam", "NewReleases"],
    votes: 480 - i, // cho điểm thấp hơn MostPlayed 1 chút để dễ sắp xếp
    source: item.url,
    date: toDateStr(item.releaseDate || new Date().toISOString()),
    submitter: "Apple Music"
  }));
}

// Nature
async function fetchNatureScience() {
  const res = await fetchWithTimeout("https://www.nature.com/subjects/science/rss.xml");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Science",
    tags: ["Nature"],
    votes: 410 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "Nature"
  }));
}
