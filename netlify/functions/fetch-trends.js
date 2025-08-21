// File: netlify/functions/fetch-trends.js
const fetch = require('node-fetch');

// Helper: fetch with timeout
async function fetchWithTimeout(url, options = {}, ms = 7000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    // Ném lỗi để Promise.all có thể bắt được
    throw new Error(`Timeout or network error for ${url}: ${err.message}`);
  }
}

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
  };

  // OPTIONS request is handled by Netlify, but this is good practice
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }};
  }
  
  try {
    const sources = [
        fetchHackerNewsFrontpage(),
        fetchVnExpressInternational(),
        fetchTheVerge(),
        fetchTechCrunch(),
        fetchIGNGaming(),
        fetchVentureBeatAI(),
        fetchGoogleNewsVN(),
        // --- Tạm thời vô hiệu hóa các nguồn có thể chậm để tránh timeout ---
        // fetchBBCWorld(),
        // fetchYahooFinance(),
        // fetchAppleMusicVN(),
        // fetchVariety(),
        // fetchCNNWorld(),
        // fetchWired(),
        // fetchAlJazeeraAll()
    ];

    // Xử lý kết quả một cách an toàn, nếu 1 nguồn lỗi thì vẫn tiếp tục
    const results = await Promise.allSettled(sources);
    
    let allFetchedTrends = [];
    results.forEach(result => {
        if (result.status === 'fulfilled') {
            allFetchedTrends.push(...result.value);
        } else {
            console.warn("A source failed to fetch:", result.reason.message);
        }
    });

    // Gộp & chuẩn hoá
    let trends = allFetchedTrends
      .filter(Boolean)
      .map((t) => ({
        ...t,
        views: toNumOrUndef(t.views),
        engagement: toNumOrUndef(t.engagement),
        votes: toNumOrZero(t.votes),
      }))
      .sort((a, b) => (b.votes || 0) - (a.votes || 0)); // Sắp xếp theo votes ban đầu

    // Gán id tăng dần
    trends = trends.map((t, i) => ({ ...t, id: i + 1 }));

    return {
      statusCode: 200,
      headers: { ...headers, "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        success: true,
        trends,
      })
    };
  } catch (error) {
    console.error("fetch-trends handler error", error);
    return {
      statusCode: 500,
      headers: { ...headers, "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        success: false,
        error: "Failed to fetch live trends",
        message: error.message
      })
    };
  }
};

// ============ Helpers ============
function toNumOrUndef(v) { const n = Number(v); return Number.isFinite(n) ? n : undefined; }
function toNumOrZero(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function decodeHtmlEntities(str = "") { return str.replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">"); }
function getTag(block, tag) { const cdata = new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]><\\/${tag}>`, "is"); const plain = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"); let m = block.match(cdata) || block.match(plain); return m ? decodeHtmlEntities(m[1].trim()) : ""; }
function rssItems(xml, max = 10) { const items = []; const reg = /<item[\s\S]*?>([\s\S]*?)<\/item>/gi; let m; while ((m = reg.exec(xml)) && items.length < max) { items.push(m[1]); } return items; }
function toDateStr(d) { const dt = d ? new Date(d) : new Date(); return isNaN(dt.getTime()) ? new Date().toLocaleDateString("en-CA") : dt.toLocaleDateString("en-CA"); } // Dùng yyyy-mm-dd

// ============ Sources (Lấy ít hơn để đảm bảo tốc độ) ============
async function fetchHackerNewsFrontpage() {
    const res = await fetchWithTimeout("https://hnrss.org/frontpage");
    if (!res.ok) return [];
    const xml = await res.text();
    return rssItems(xml, 8).map((block, i) => ({ title: getTag(block, "title"), description: getTag(block, "description"), category: "Tech", tags: ["HackerNews"], votes: 500 - i, source: getTag(block, "link"), date: toDateStr(getTag(block, "pubDate")), submitter: "Hacker News" }));
}

async function fetchVnExpressInternational() {
    const res = await fetchWithTimeout("https://e.vnexpress.net/rss/news.rss");
    if (!res.ok) return [];
    const xml = await res.text();
    return rssItems(xml, 8).map((block, i) => ({ title: getTag(block, "title"), description: getTag(block, "description"), category: "News", tags: ["VnExpress", "Vietnam"], votes: 450 - i, source: getTag(block, "link"), date: toDateStr(getTag(block, "pubDate")), submitter: "VnExpress Intl" }));
}

async function fetchTheVerge() {
    const res = await fetchWithTimeout("https://www.theverge.com/rss/index.xml");
    if (!res.ok) return [];
    const xml = await res.text();
    return rssItems(xml, 8).map((block, i) => ({ title: getTag(block, "title"), description: getTag(block, "description"), category: "Tech", tags: ["TheVerge"], votes: 400 - i, source: getTag(block, "link"), date: toDateStr(getTag(block, "pubDate")), submitter: "The Verge" }));
}

async function fetchTechCrunch() {
    const res = await fetchWithTimeout("https://techcrunch.com/feed/");
    if (!res.ok) return [];
    const xml = await res.text();
    return rssItems(xml, 8).map((block, i) => ({ title: getTag(block, "title"), description: getTag(block, "description"), category: "Tech", tags: ["TechCrunch", "Startups"], votes: 380 - i, source: getTag(block, "link"), date: toDateStr(getTag(block, "pubDate")), submitter: "TechCrunch" }));
}

async function fetchIGNGaming() {
    const res = await fetchWithTimeout("https://feeds.ign.com/ign/games-all");
    if (!res.ok) return [];
    const xml = await res.text();
    return rssItems(xml, 8).map((block, i) => ({ title: getTag(block, "title"), description: getTag(block, "description"), category: "Gaming", tags: ["IGN", "Games"], votes: 350 - i, source: getTag(block, "link"), date: toDateStr(getTag(block, "pubDate")), submitter: "IGN" }));
}

async function fetchVentureBeatAI() {
    const res = await fetchWithTimeout("https://venturebeat.com/category/ai/feed/");
    if (!res.ok) return [];
    const xml = await res.text();
    return rssItems(xml, 8).map((block, i) => ({ title: getTag(block, "title"), description: getTag(block, "description"), category: "AI", tags: ["VentureBeat", "AI"], votes: 420 - i, source: getTag(block, "link"), date: toDateStr(getTag(block, "pubDate")), submitter: "VentureBeat" }));
}

async function fetchGoogleNewsVN() {
    const res = await fetchWithTimeout("https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi");
    if (!res.ok) return [];
    const xml = await res.text();
    return rssItems(xml, 8).map((block, i) => ({ title: getTag(block, "title"), description: getTag(block, "description"), category: "News", tags: ["GoogleNews", "Vietnam"], votes: 300 - i, source: getTag(block, "link"), date: toDateStr(getTag(block, "pubDate")), submitter: "Google News VN" }));
}
