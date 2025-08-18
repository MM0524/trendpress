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
      appleMusic,
      variety,
      ign,
      ventureBeatAI,
      reddit,
      youtube,
    ] = await Promise.all([
      fetchHackerNewsFrontpage(),
      fetchBBCWorld(),
      fetchVnExpressInternational(),
      fetchYahooFinance(),
      fetchAppleMusicTop(),
      fetchVariety(),
      fetchIGN(),
      fetchVentureBeatAI(),
      fetchReddit(),
      fetchYouTubeTrending(),
    ]);

    // Merge & normalize
    let trends = [
      ...hackerNews,
      ...bbcWorld,
      ...vnexpressIntl,
      ...yahooFinance,
      ...appleMusic,
      ...variety,
      ...ign,
      ...ventureBeatAI,
      ...reddit,
      ...youtube,
    ]
      .filter(Boolean)
      .map((t) => ({
        ...t,
        views: Number.isFinite(Number(t.views)) ? Number(t.views) : undefined,
        engagement: Number.isFinite(Number(t.engagement))
          ? Number(t.engagement)
          : undefined,
        votes: Number.isFinite(Number(t.votes)) ? Number(t.votes) : 0,
      }))
      .sort(
        (a, b) =>
          (Number(b.views) ||
            Number(b.engagement) ||
            Number(b.votes) ||
            0) -
          (Number(a.views) || Number(a.engagement) || Number(a.votes) || 0)
      );

    // assign id
    trends = trends.map((t, i) => ({ ...t, id: i + 1 }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        count: trends.length,
        trends,
      }),
    };
  } catch (error) {
    console.error("fetch-trends error", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: "Failed to fetch live trends",
        message: error.message,
      }),
    };
  }
};

// =============== FETCHERS ===============

// Hacker News
async function fetchHackerNewsFrontpage() {
  try {
    const url = "https://hnrss.org/frontpage";
    const res = await fetch(url);
    const xml = await res.text();

    const items = [];
    const regex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 500;
    while ((match = regex.exec(xml)) && items.length < 20) {
      const block = match[1];
      const title =
        (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
          block.match(/<title>(.*?)<\/title>/) ||
          [])[1] || "Hacker News";
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || "#";
      items.push({
        title,
        description: "",
        category: "Tech",
        tags: ["HackerNews"],
        votes: rank--,
        source: link,
        date: new Date().toLocaleDateString("en-US"),
        submitter: "Hacker News",
      });
    }
    return items;
  } catch {
    return [];
  }
}

// BBC
async function fetchBBCWorld() {
  try {
    const res = await fetch("https://feeds.bbci.co.uk/news/world/rss.xml");
    const xml = await res.text();
    const items = [];
    const regex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 400;
    while ((match = regex.exec(xml)) && items.length < 20) {
      const block = match[1];
      const title =
        (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
          block.match(/<title>(.*?)<\/title>/) ||
          [])[1] || "BBC News";
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || "#";
      const desc =
        (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
          [])[1] || "";
      items.push({
        title,
        description: desc,
        category: "World",
        tags: ["BBC"],
        votes: rank--,
        source: link,
        date: new Date().toLocaleDateString("en-US"),
        submitter: "BBC World",
      });
    }
    return items;
  } catch {
    return [];
  }
}

// VnExpress
async function fetchVnExpressInternational() {
  try {
    const res = await fetch("https://e.vnexpress.net/rss/news.rss");
    const xml = await res.text();
    const items = [];
    const regex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 300;
    while ((match = regex.exec(xml)) && items.length < 20) {
      const block = match[1];
      const title =
        (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
          block.match(/<title>(.*?)<\/title>/) ||
          [])[1] || "VnExpress";
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || "#";
      items.push({
        title,
        description: "",
        category: "News",
        tags: ["VnExpress"],
        votes: rank--,
        source: link,
        date: new Date().toLocaleDateString("en-US"),
        submitter: "VnExpress",
      });
    }
    return items;
  } catch {
    return [];
  }
}

// Yahoo Finance
async function fetchYahooFinance() {
  try {
    const res = await fetch("https://finance.yahoo.com/rss/");
    const xml = await res.text();
    const items = [];
    const regex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 250;
    while ((match = regex.exec(xml)) && items.length < 20) {
      const block = match[1];
      const title =
        (block.match(/<title>(.*?)<\/title>/) || [])[1] || "Yahoo Finance";
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || "#";
      items.push({
        title,
        description: "",
        category: "Finance",
        tags: ["Finance"],
        votes: rank--,
        source: link,
        date: new Date().toLocaleDateString("en-US"),
        submitter: "Yahoo Finance",
      });
    }
    return items;
  } catch {
    return [];
  }
}

// Apple Music Top Songs (via RSS)
async function fetchAppleMusicTop() {
  try {
    const res = await fetch(
      "https://rss.applemarketingtools.com/api/v2/us/music/most-played/10/songs.json"
    );
    const json = await res.json();
    return json.feed.results.map((s, i) => ({
      title: s.name + " - " + s.artistName,
      description: "",
      category: "Music",
      tags: ["AppleMusic"],
      votes: 200 - i,
      source: s.url,
      date: new Date().toLocaleDateString("en-US"),
      submitter: "Apple Music",
    }));
  } catch {
    return [];
  }
}

// Variety
async function fetchVariety() {
  try {
    const res = await fetch("https://variety.com/feed/");
    const xml = await res.text();
    const items = [];
    const regex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 180;
    while ((match = regex.exec(xml)) && items.length < 15) {
      const block = match[1];
      const title = (block.match(/<title>(.*?)<\/title>/) || [])[1];
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1];
      items.push({
        title,
        description: "",
        category: "Media",
        tags: ["Variety"],
        votes: rank--,
        source: link,
        date: new Date().toLocaleDateString("en-US"),
        submitter: "Variety",
      });
    }
    return items;
  } catch {
    return [];
  }
}

// IGN Gaming
async function fetchIGN() {
  try {
    const res = await fetch("https://feeds.ign.com/ign/all");
    const xml = await res.text();
    const items = [];
    const regex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 150;
    while ((match = regex.exec(xml)) && items.length < 15) {
      const block = match[1];
      const title = (block.match(/<title>(.*?)<\/title>/) || [])[1];
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1];
      items.push({
        title,
        description: "",
        category: "Gaming",
        tags: ["IGN"],
        votes: rank--,
        source: link,
        date: new Date().toLocaleDateString("en-US"),
        submitter: "IGN",
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
    const res = await fetch("https://venturebeat.com/category/ai/feed/");
    const xml = await res.text();
    const items = [];
    const regex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 130;
    while ((match = regex.exec(xml)) && items.length < 15) {
      const block = match[1];
      const title = (block.match(/<title>(.*?)<\/title>/) || [])[1];
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1];
      items.push({
        title,
        description: "",
        category: "AI",
        tags: ["VentureBeat"],
        votes: rank--,
        source: link,
        date: new Date().toLocaleDateString("en-US"),
        submitter: "VentureBeat AI",
      });
    }
    return items;
  } catch {
    return [];
  }
}

// Reddit (r/news)
async function fetchReddit() {
  try {
    const res = await fetch("https://www.reddit.com/r/news/top.json?limit=10");
    const json = await res.json();
    return json.data.children.map((p, i) => ({
      title: p.data.title,
      description: "",
      category: "Social",
      tags: ["Reddit"],
      votes: 100 - i,
      source: "https://reddit.com" + p.data.permalink,
      date: new Date(p.data.created_utc * 1000).toLocaleDateString("en-US"),
      submitter: p.data.author,
    }));
  } catch {
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
