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
      youtube,
      redditTrends
    ] = await Promise.all([
      fetchHackerNewsFrontpage(),
      fetchBBCWorld(),
      fetchVnExpressInternational(),
      fetchYahooFinance(),
      fetchAppleMusic(),
      fetchVariety(),
      fetchVentureBeatAI(),
      fetchYouTubeTrending(),
      fetchRedditTrends()
    ]);

    let trends = [
      ...hackerNews,
      ...bbcWorld,
      ...vnexpressIntl,
      ...yahooFinance,
      ...appleMusic,
      ...variety,
      ...ventureBeatAI,
      ...youtube,
      ...redditTrends
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
          reddit: redditTrends.length
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

// YouTube Trending
async function fetchYouTubeTrending() {
  try {
    const res = await fetch(
      "https://www.youtube.com/feeds/videos.xml?playlist_id=PLrEnWoR732-BHrPp_Pm8_VleD68f9s14-"
    );
    const xml = await res.text();
    const items = [];
    const regex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;
    let rank = 90;
    while ((match = regex.exec(xml)) && items.length < 10) {
      const block = match[1];
      const title = (block.match(/<title>(.*?)<\/title>/) || [])[1];
      const link = (block.match(/<link rel="alternate" href="(.*?)"/) || [])[1];
      items.push({
        title,
        description: "",
        category: "Video",
        tags: ["YouTube"],
        votes: rank--,
        source: link,
        date: new Date().toLocaleDateString("en-US"),
        submitter: "YouTube Trending",
      });
    }
    return items;
  } catch {
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

// Reddit Trends
async function fetchRedditTrends() {
  try {
    const res = await fetch(
      "https://www.reddit.com/r/trendingsubreddits/top.json?limit=10",
      {
        headers: { "User-Agent": "trend-fetcher-bot/1.0" }
      }
    );
    if (!res.ok) throw new Error(`Reddit HTTP ${res.status}`);
    const json = await res.json();

    return json.data.children.map((c, i) => ({
      title: c.data.title,
      description: c.data.selftext || "",
      category: "Social",
      tags: ["Reddit"],
      votes: c.data.ups || 50 - i,
      source: "https://reddit.com" + c.data.permalink,
      date: new Date(c.data.created_utc * 1000).toLocaleDateString("en-US"),
      submitter: c.data.author || "Reddit User"
    }));
  } catch (e) {
    console.warn("Reddit fetch failed:", e.message);
    return [];
  }
}
