
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

// fetch-trends.js

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json"
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
      appleMusic,
      variety,
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
      fetchAppleMusic(),
      fetchVariety(),
      fetchVentureBeatAI(),
      fetchGoogleNewsVN(),
      fetchCNNWorld(),
      fetchTheVerge(),
      fetchTechCrunch(),
      fetchWired(),
      fetchAlJazeeraAll()
    ]);

    let trends = [
      ...hackerNews,
      ...bbcWorld,
      ...vnexpressIntl,
      ...yahooFinance,
      ...appleMusic,
      ...variety,
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
        views: Number.isFinite(Number(t.views)) ? Number(t.views) : undefined,
        engagement: Number.isFinite(Number(t.engagement)) ? Number(t.engagement) : undefined,
        votes: Number.isFinite(Number(t.votes)) ? Number(t.votes) : 0
      }))
      .sort(
        (a, b) =>
          (Number(b.views) || Number(b.engagement) || Number(b.votes) || 0) -
          (Number(a.views) || Number(a.engagement) || Number(a.votes) || 0)
      );

    // Assign incremental ids
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
          appleMusic: appleMusic.length,
          variety: variety.length,
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

// Hacker News
async function fetchHackerNewsFrontpage() {
  try {
    const url = "https://hnrss.org/frontpage";
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HackerNews HTTP ${res.status}`);
    const xml = await res.text();

    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 500;

    while ((match = itemRegex.exec(xml)) && items.length < 25) {
      const block = match[1];
      const title =
        (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
          block.match(/<title>(.*?)<\/title>/) ||
          [])[1] || "Hacker News";
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || "#";
      const pubDate =
        (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || new Date().toUTCString();
      const description =
        (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
          block.match(/<description>(.*?)<\/description>/) ||
          [])[1] || "";

      items.push({
        title,
        description,
        category: "Tech",
        tags: ["HackerNews"],
        votes: rank--,
        source: link,
        date: new Date(pubDate).toLocaleDateString("en-US"),
        submitter: "Hacker News Frontpage"
      });
    }
    return items;
  } catch (e) {
    console.warn("Hacker News fetch failed", e.message);
    return [];
  }
}

// BBC
async function fetchBBCWorld() {
  try {
    const url = "https://feeds.bbci.co.uk/news/world/rss.xml";
    const res = await fetch(url);
    if (!res.ok) throw new Error(`BBC HTTP ${res.status}`);
    const xml = await res.text();

    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 180;

    while ((match = itemRegex.exec(xml)) && items.length < 25) {
      const block = match[1];
      const title =
        (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
          block.match(/<title>(.*?)<\/title>/) ||
          [])[1] || "BBC News";
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || "#";
      const pubDate =
        (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || new Date().toUTCString();
      const description =
        (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
          block.match(/<description>(.*?)<\/description>/) ||
          [])[1] || "";

      items.push({
        title,
        description,
        category: "World",
        tags: ["BBCWorld"],
        votes: rank--,
        source: link,
        date: new Date(pubDate).toLocaleDateString("en-US"),
        submitter: "BBC World News"
      });
    }

    return items;
  } catch (e) {
    console.warn("BBC World fetch failed", e.message);
    return [];
  }
}

// VnExpress
async function fetchVnExpressInternational() {
  try {
    const url = "https://e.vnexpress.net/rss/news.rss";
    const res = await fetch(url);
    if (!res.ok) throw new Error(`VnExpress HTTP ${res.status}`);
    const xml = await res.text();
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 200;

    while ((match = itemRegex.exec(xml)) && items.length < 25) {
      const block = match[1];
      const title =
        (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
          block.match(/<title>(.*?)<\/title>/) ||
          [])[1] || "VnExpress News";
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || "#";
      const pubDate =
        (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || new Date().toUTCString();
      const description =
        (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
          block.match(/<description>(.*?)<\/description>/) ||
          [])[1] || "";
      items.push({
        title,
        description,
        category: "News",
        tags: ["VnExpressInternational"],
        votes: rank--,
        source: link,
        date: new Date(pubDate).toLocaleDateString("en-US"),
        submitter: "VnExpress International"
      });
    }
    return items;
  } catch (e) {
    console.warn("VnExpress International fetch failed", e.message);
    return [];
  }
}

// Yahoo Finance
async function fetchYahooFinance() {
  try {
    const url = "https://feeds.finance.yahoo.com/rss/2.0/headline?s=yhoo&region=US&lang=en-US";
    const res = await fetch(url);
    if (!res.ok) throw new Error(`YahooFinance HTTP ${res.status}`);
    const xml = await res.text();

    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 160;

    while ((match = itemRegex.exec(xml)) && items.length < 20) {
      const block = match[1];
      const title =
        (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
          block.match(/<title>(.*?)<\/title>/) ||
          [])[1] || "Yahoo Finance";
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || "#";
      const description =
        (block.match(/<description>(.*?)<\/description>/) || [])[1] || "";

      items.push({
        title,
        description,
        category: "Finance",
        tags: ["YahooFinance"],
        votes: rank--,
        source: link,
        date: new Date().toLocaleDateString("en-US"),
        submitter: "Yahoo Finance"
      });
    }
    return items;
  } catch (e) {
    console.warn("Yahoo Finance fetch failed", e.message);
    return [];
  }
}

// Apple Music
async function fetchAppleMusic() {
  try {
    const url =
      "https://rss.applemarketingtools.com/api/v2/us/music/most-played/10/songs.json";
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Apple Music HTTP ${res.status}`);
    const json = await res.json();

    return json.feed.results.map((song, i) => ({
      title: song.name,
      description: song.artistName,
      category: "Music",
      tags: ["AppleMusic"],
      votes: 150 - i,
      source: song.url,
      date: new Date().toLocaleDateString("en-US"),
      submitter: "Apple Music"
    }));
  } catch (e) {
    console.warn("Apple Music fetch failed", e.message);
    return [];
  }
}

// Variety
async function fetchVariety() {
  try {
    const url = "https://variety.com/feed/";
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Variety HTTP ${res.status}`);
    const xml = await res.text();
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 140;

    while ((match = itemRegex.exec(xml)) && items.length < 15) {
      const block = match[1];
      const title =
        (block.match(/<title>(.*?)<\/title>/) || [])[1] || "Variety";
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || "#";
      const description =
        (block.match(/<description>(.*?)<\/description>/) || [])[1] || "";

      items.push({
        title,
        description,
        category: "Media",
        tags: ["Variety"],
        votes: rank--,
        source: link,
        date: new Date().toLocaleDateString("en-US"),
        submitter: "Variety"
      });
    }
    return items;
  } catch (e) {
    console.warn("Variety fetch failed", e.message);
    return [];
  }
}


// VentureBeat AI
async function fetchVentureBeatAI() {
  try {
    const url = "https://venturebeat.com/category/ai/feed/";
    const res = await fetch(url);
    if (!res.ok) throw new Error(`VentureBeat HTTP ${res.status}`);
    const xml = await res.text();
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 100;

    while ((match = itemRegex.exec(xml)) && items.length < 15) {
      const block = match[1];
      const title =
        (block.match(/<title>(.*?)<\/title>/) || [])[1] || "VentureBeat AI";
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || "#";
      const description =
        (block.match(/<description>(.*?)<\/description>/) || [])[1] || "";

      items.push({
        title,
        description,
        category: "AI",
        tags: ["VentureBeat"],
        votes: rank--,
        source: link,
        date: new Date().toLocaleDateString("en-US"),
        submitter: "VentureBeat AI"
      });
    }
    return items;
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
