
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

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const [
      hackerNews,
      bbcWorld,
      vnexpressIntl,
      yahooFinance,
      appleMusicVN,
      variety,
      ignGaming,
      ventureBeatAI,
      googleNewsVN,
      cnnWorld,
      theVerge,
      techCrunch,
      wired,
      alJazeera
    ] = await Promise.all([
      fetchHackerNewsFrontpage(),
      fetchBBCWorld(),
      fetchVnExpressInternational(),
      fetchYahooFinance(),
      fetchAppleMusicVN(),
      fetchVariety(),
      fetchIGNGaming(),
      fetchVentureBeatAI(),
      fetchGoogleNewsVN(),
      fetchCNNWorld(),
      fetchTheVerge(),
      fetchTechCrunch(),
      fetchWired(),
      fetchAlJazeeraAll()
    ]);

    // Gộp & chuẩn hoá
    let trends = [
      ...hackerNews,
      ...bbcWorld,
      ...vnexpressIntl,
      ...yahooFinance,
      ...appleMusicVN,
      ...variety,
      ...ignGaming,
      ...ventureBeatAI,
      ...googleNewsVN,
      ...cnnWorld,
      ...theVerge,
      ...techCrunch,
      ...wired,
      ...alJazeera
    ]
      .filter(Boolean)
      .map((t) => ({
        ...t,
        views: toNumOrUndef(t.views),
        engagement: toNumOrUndef(t.engagement),
        votes: toNumOrZero(t.votes),
      }))
      .sort((a, b) => (
        (b.views ?? b.engagement ?? b.votes ?? 0) -
        (a.views ?? a.engagement ?? a.votes ?? 0)
      ));

    // Gán id tăng dần
    trends = trends.map((t, i) => ({ ...t, id: i + 1 }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        trends,
        sources: {
          hackerNews: hackerNews.length,
          bbcWorld: bbcWorld.length,
          vnexpressIntl: vnexpressIntl.length,
          yahooFinance: yahooFinance.length,
          appleMusicVN: appleMusicVN.length,
          variety: variety.length,
          ignGaming: ignGaming.length,
          ventureBeatAI: ventureBeatAI.length,
          googleNewsVN: googleNewsVN.length,
          cnnWorld: cnnWorld.length,
          theVerge: theVerge.length,
          techCrunch: techCrunch.length,
          wired: wired.length,
          alJazeera: alJazeera.length
        }
      })
    };
  } catch (error) {
    console.error("fetch-trends error", error);
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

function toNumOrUndef(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function toNumOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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
  // Ưu tiên CDATA, fallback text
  const cdata = new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]><\\/${tag}>`, "is");
  const plain = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
  let m = block.match(cdata) || block.match(plain);
  return m ? decodeHtmlEntities(m[1].trim()) : "";
}
function rssItems(xml, max = 25) {
  const items = [];
  const reg = /<item[\s\S]*?>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = reg.exec(xml)) && items.length < max) {
    items.push(m[1]);
  }
  return items;
}
function toDateStr(d) {
  const dt = d ? new Date(d) : new Date();
  return isNaN(dt.getTime()) ? new Date().toLocaleDateString("en-US") : dt.toLocaleDateString("en-US");
}

// ============ Sources ============

// Tech → Hacker News
async function fetchHackerNewsFrontpage() {
  try {
    const res = await fetch("https://hnrss.org/frontpage");
    if (!res.ok) throw new Error(`HackerNews HTTP ${res.status}`);
    const xml = await res.text();

    let rank = 500;
    return rssItems(xml, 25).map(block => ({
      title: getTag(block, "title") || "Hacker News",
      description: getTag(block, "description") || "",
      category: "Tech",
      tags: ["HackerNews"],
      votes: rank--,
      source: getTag(block, "link") || "#",
      date: toDateStr(getTag(block, "pubDate")),
      submitter: "Hacker News Frontpage"
    }));
  } catch (e) {
    console.warn("Hacker News fetch failed", e.message);
    return [];
  }
}

// World → BBC
async function fetchBBCWorld() {
  try {
    const res = await fetch("https://feeds.bbci.co.uk/news/world/rss.xml");
    if (!res.ok) throw new Error(`BBC HTTP ${res.status}`);
    const xml = await res.text();

    let rank = 300;
    return rssItems(xml, 25).map(block => ({
      title: getTag(block, "title") || "BBC News",
      description: getTag(block, "description") || "",
      category: "World",
      tags: ["BBCWorld"],
      votes: rank--,
      source: getTag(block, "link") || "#",
      date: toDateStr(getTag(block, "pubDate")),
      submitter: "BBC World"
    }));
  } catch (e) {
    console.warn("BBC World fetch failed", e.message);
    return [];
  }
}

// News → VnExpress (International)
async function fetchVnExpressInternational() {
  try {
    const res = await fetch("https://e.vnexpress.net/rss/news.rss");
    if (!res.ok) throw new Error(`VnExpress HTTP ${res.status}`);
    const xml = await res.text();

    let rank = 260;
    return rssItems(xml, 25).map(block => ({
      title: getTag(block, "title") || "VnExpress News",
      description: getTag(block, "description") || "",
      category: "News",
      tags: ["VnExpressInternational", "Vietnam"],
      votes: rank--,
      source: getTag(block, "link") || "#",
      date: toDateStr(getTag(block, "pubDate")),
      submitter: "VnExpress International"
    }));
  } catch (e) {
    console.warn("VnExpress fetch failed", e.message);
    return [];
  }
}

// Finance → Yahoo Finance
async function fetchYahooFinance() {
  try {
    const res = await fetch("https://feeds.finance.yahoo.com/rss/2.0/headline?s=yhoo&region=US&lang=en-US");
    if (!res.ok) throw new Error(`YahooFinance HTTP ${res.status}`);
    const xml = await res.text();

    let rank = 240;
    return rssItems(xml, 20).map(block => ({
      title: getTag(block, "title") || "Yahoo Finance",
      description: getTag(block, "description") || "",
      category: "Finance",
      tags: ["YahooFinance"],
      votes: rank--,
      source: getTag(block, "link") || "#",
      date: toDateStr(getTag(block, "pubDate")),
      submitter: "Yahoo Finance"
    }));
  } catch (e) {
    console.warn("Yahoo Finance fetch failed", e.message);
    return [];
  }
}

// Music → Apple Music Top Songs (Vietnam)
async function fetchAppleMusicVN() {
  try {
    const res = await fetch("https://rss.applemarketingtools.com/api/v2/vn/music/most-played/20/songs.json");
    if (!res.ok) throw new Error(`Apple Music HTTP ${res.status}`);
    const json = await res.json();

    return (json?.feed?.results || []).map((song, i) => ({
      title: `${song.name} - ${song.artistName}`,
      description: "Apple Music Top Songs (VN)",
      category: "Music",
      tags: ["AppleMusic", "Vietnam"],
      votes: 220 - i,
      source: song.url,
      date: toDateStr(),
      submitter: "Apple Music VN"
    }));
  } catch (e) {
    console.warn("Apple Music VN fetch failed", e.message);
    return [];
  }
}

// Media → Variety
async function fetchVariety() {
  try {
    const res = await fetch("https://variety.com/feed/");
    if (!res.ok) throw new Error(`Variety HTTP ${res.status}`);
    const xml = await res.text();

    let rank = 210;
    return rssItems(xml, 20).map(block => ({
      title: getTag(block, "title") || "Variety",
      description: getTag(block, "description") || "",
      category: "Media",
      tags: ["Variety"],
      votes: rank--,
      source: getTag(block, "link") || "#",
      date: toDateStr(getTag(block, "pubDate")),
      submitter: "Variety"
    }));
  } catch (e) {
    console.warn("Variety fetch failed", e.message);
    return [];
  }
}

// Gaming → IGN
async function fetchIGNGaming() {
  try {
    const res = await fetch("https://feeds.ign.com/ign/games-all");
    if (!res.ok) throw new Error(`IGN HTTP ${res.status}`);
    const xml = await res.text();

    let rank = 200;
    return rssItems(xml, 20).map(block => ({
      title: getTag(block, "title") || "IGN Gaming",
      description: getTag(block, "description") || "",
      category: "Gaming",
      tags: ["IGN"],
      votes: rank--,
      source: getTag(block, "link") || "#",
      date: toDateStr(getTag(block, "pubDate")),
      submitter: "IGN"
    }));
  } catch (e) {
    console.warn("IGN Gaming fetch failed", e.message);
    return [];
  }
}

// AI → VentureBeat AI
async function fetchVentureBeatAI() {
  try {
    const res = await fetch("https://venturebeat.com/category/ai/feed/");
    if (!res.ok) throw new Error(`VentureBeat HTTP ${res.status}`);
    const xml = await res.text();

    let rank = 190;
    return rssItems(xml, 20).map(block => ({
      title: getTag(block, "title") || "VentureBeat AI",
      description: getTag(block, "description") || "",
      category: "AI",
      tags: ["VentureBeat"],
      votes: rank--,
      source: getTag(block, "link") || "#",
      date: toDateStr(getTag(block, "pubDate")),
      submitter: "VentureBeat AI"
    }));
  } catch (e) {
    console.warn("VentureBeat AI fetch failed", e.message);
    return [];
  }
}

// News → Google News Vietnam
async function fetchGoogleNewsVN() {
  try {
    const res = await fetch("https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi");
    if (!res.ok) throw new Error(`Google News HTTP ${res.status}`);
    const xml = await res.text();

    let rank = 170;
    return rssItems(xml, 20).map(block => ({
      title: getTag(block, "title") || "Google News",
      description: getTag(block, "description") || "",
      category: "News",
      tags: ["GoogleNews", "Vietnam"],
      votes: rank--,
      source: getTag(block, "link") || "#",
      date: toDateStr(getTag(block, "pubDate")),
      submitter: "Google News VN"
    }));
  } catch (e) {
    console.warn("Google News VN fetch failed", e.message);
    return [];
  }
}

// World → CNN World
async function fetchCNNWorld() {
  try {
    const res = await fetch("https://rss.cnn.com/rss/edition_world.rss");
    if (!res.ok) throw new Error(`CNN HTTP ${res.status}`);
    const xml = await res.text();

    let rank = 165;
    return rssItems(xml, 15).map(block => ({
      title: getTag(block, "title") || "CNN World",
      description: getTag(block, "description") || "",
      category: "World",
      tags: ["CNN"],
      votes: rank--,
      source: getTag(block, "link") || "#",
      date: toDateStr(getTag(block, "pubDate")),
      submitter: "CNN World"
    }));
  } catch (e) {
    console.warn("CNN World fetch failed", e.message);
    return [];
  }
}

// Tech Media → The Verge
async function fetchTheVerge() {
  try {
    const res = await fetch("https://www.theverge.com/rss/index.xml");
    if (!res.ok) throw new Error(`The Verge HTTP ${res.status}`);
    const xml = await res.text();

    let rank = 160;
    return rssItems(xml, 15).map(block => ({
      title: getTag(block, "title") || "The Verge",
      description: getTag(block, "description") || "",
      category: "Tech",
      tags: ["TheVerge"],
      votes: rank--,
      source: getTag(block, "link") || "#",
      date: toDateStr(getTag(block, "pubDate")),
      submitter: "The Verge"
    }));
  } catch (e) {
    console.warn("The Verge fetch failed", e.message);
    return [];
  }
}

// Tech → TechCrunch
async function fetchTechCrunch() {
  try {
    const res = await fetch("https://techcrunch.com/feed/");
    if (!res.ok) throw new Error(`TechCrunch HTTP ${res.status}`);
    const xml = await res.text();

    let rank = 155;
    return rssItems(xml, 15).map(block => ({
      title: getTag(block, "title") || "TechCrunch",
      description: getTag(block, "description") || "",
      category: "Tech",
      tags: ["TechCrunch"],
      votes: rank--,
      source: getTag(block, "link") || "#",
      date: toDateStr(getTag(block, "pubDate")),
      submitter: "TechCrunch"
    }));
  } catch (e) {
    console.warn("TechCrunch fetch failed", e.message);
    return [];
  }
}

// Tech → WIRED
async function fetchWired() {
  try {
    const res = await fetch("https://www.wired.com/feed/rss");
    if (!res.ok) throw new Error(`Wired HTTP ${res.status}`);
    const xml = await res.text();

    let rank = 150;
    return rssItems(xml, 15).map(block => ({
      title: getTag(block, "title") || "WIRED",
      description: getTag(block, "description") || "",
      category: "Tech",
      tags: ["Wired"],
      votes: rank--,
      source: getTag(block, "link") || "#",
      date: toDateStr(getTag(block, "pubDate")),
      submitter: "WIRED"
    }));
  } catch (e) {
    console.warn("Wired fetch failed", e.message);
    return [];
  }
}

// World → Al Jazeera (All)
async function fetchAlJazeeraAll() {
  try {
    const res = await fetch("https://www.aljazeera.com/xml/rss/all.xml");
    if (!res.ok) throw new Error(`Al Jazeera HTTP ${res.status}`);
    const xml = await res.text();

    let rank = 145;
    return rssItems(xml, 15).map(block => ({
      title: getTag(block, "title") || "Al Jazeera",
      description: getTag(block, "description") || "",
      category: "World",
      tags: ["AlJazeera"],
      votes: rank--,
      source: getTag(block, "link") || "#",
      date: toDateStr(getTag(block, "pubDate")),
      submitter: "Al Jazeera"
    }));
  } catch (e) {
    console.warn("Al Jazeera fetch failed", e.message);
    return [];
  }
}

