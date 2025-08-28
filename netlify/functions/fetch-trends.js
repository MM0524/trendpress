// File: netlify/functions/fetch-trends.js
const fetch = require("node-fetch");
const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

// ===== Helpers =====
async function fetchWithTimeout(url, options = {}, ms = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseRSS(xml) {
  try {
    const data = parser.parse(xml);
    const items = data?.rss?.channel?.item || data?.feed?.entry || [];
    return Array.isArray(items) ? items : [items];
  } catch (e) {
    console.warn("XML parse error:", e.message);
    return [];
  }
}

function formatItem(item, source) {
  return {
    title: item.title?.["#text"] || item.title || "No title",
    link: item.link?.["@_href"] || item.link || item.guid || "",
    pubDate: item.pubDate || item.published || item.updated || new Date().toISOString(),
    source,
  };
}

// ===== Sources =====
async function fetchHackerNewsFrontpage() {
  const xml = await fetchWithTimeout("https://hnrss.org/frontpage");
  return parseRSS(xml).map((i) => formatItem(i, "Hacker News"));
}

async function fetchTheVerge() {
  const xml = await fetchWithTimeout("https://www.theverge.com/rss/index.xml");
  return parseRSS(xml).map((i) => formatItem(i, "The Verge"));
}

async function fetchIGNGaming() {
  const xml = await fetchWithTimeout("https://www.ign.com/rss");
  return parseRSS(xml).map((i) => formatItem(i, "IGN Gaming"));
}

async function fetchVentureBeatAI() {
  const xml = await fetchWithTimeout("https://venturebeat.com/category/ai/feed/");
  return parseRSS(xml).map((i) => formatItem(i, "VentureBeat AI"));
}

async function fetchMITTech() {
  const xml = await fetchWithTimeout("https://www.technologyreview.com/feed/");
  return parseRSS(xml).map((i) => formatItem(i, "MIT Tech Review"));
}

async function fetchGoogleNewsVN() {
  const xml = await fetchWithTimeout("https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi");
  return parseRSS(xml).map((i) => formatItem(i, "Google News VN"));
}

async function fetchYahooFinance() {
  const xml = await fetchWithTimeout("https://finance.yahoo.com/news/rssindex");
  return parseRSS(xml).map((i) => formatItem(i, "Yahoo Finance"));
}

async function fetchCNBCFinance() {
  const xml = await fetchWithTimeout("https://www.cnbc.com/id/10000664/device/rss/rss.html");
  return parseRSS(xml).map((i) => formatItem(i, "CNBC Finance"));
}

async function fetchScienceMagazine() {
  const xml = await fetchWithTimeout("https://www.sciencemag.org/rss/news_current.xml");
  return parseRSS(xml).map((i) => formatItem(i, "Science Magazine"));
}

async function fetchNewScientist() {
  const xml = await fetchWithTimeout("https://www.newscientist.com/feed/home/");
  return parseRSS(xml).map((i) => formatItem(i, "New Scientist"));
}

async function fetchAppleMusicMostPlayedVN() {
  const res = await fetchWithTimeout("https://rss.applemarketingtools.com/api/v2/vn/music/most-played/10/songs.json");
  const data = JSON.parse(res);
  return data.feed.results.map((i) => ({
    title: i.name,
    link: i.url,
    pubDate: i.releaseDate || new Date().toISOString(),
    source: "Apple Music Most Played VN",
  }));
}

async function fetchAppleMusicNewReleasesVN() {
  const res = await fetchWithTimeout("https://rss.applemarketingtools.com/api/v2/vn/music/new-releases/10/albums.json");
  const data = JSON.parse(res);
  return data.feed.results.map((i) => ({
    title: i.name,
    link: i.url,
    pubDate: i.releaseDate || new Date().toISOString(),
    source: "Apple Music New Releases VN",
  }));
}

async function fetchYouTubeTrendingVN() {
  const res = await fetchWithTimeout("https://yt.lemnoslife.com/charts/trending?region=VN");
  const data = JSON.parse(res);
  return (data?.items || []).map((i) => ({
    title: i.snippet.title,
    link: `https://www.youtube.com/watch?v=${i.id}`,
    pubDate: i.snippet.publishedAt,
    source: "YouTube Trending VN",
  }));
}

async function fetchVariety() {
  const xml = await fetchWithTimeout("https://variety.com/feed/");
  return parseRSS(xml).map((i) => formatItem(i, "Variety"));
}

async function fetchDeadline() {
  const xml = await fetchWithTimeout("https://deadline.com/feed/");
  return parseRSS(xml).map((i) => formatItem(i, "Deadline"));
}

async function fetchGameKVN() {
  const xml = await fetchWithTimeout("https://gamek.vn/rss/home.rss");
  return parseRSS(xml).map((i) => formatItem(i, "GameK VN"));
}

async function fetchZingNewsEntertainment() {
  const xml = await fetchWithTimeout("https://zingnews.vn/rss/giai-tri.rss");
  return parseRSS(xml).map((i) => formatItem(i, "Zing News Giải trí"));
}

async function fetchBBCWorld() {
  const xml = await fetchWithTimeout("http://feeds.bbci.co.uk/news/world/rss.xml");
  return parseRSS(xml).map((i) => formatItem(i, "BBC World"));
}

async function fetchESPN() {
  const xml = await fetchWithTimeout("https://www.espn.com/espn/rss/news");
  return parseRSS(xml).map((i) => formatItem(i, "ESPN"));
}

async function fetchLogistics() {
  const xml = await fetchWithTimeout("https://www.logisticsmgmt.com/rss");
  return parseRSS(xml).map((i) => formatItem(i, "Logistics"));
}

async function fetchCybernews() {
  const xml = await fetchWithTimeout("https://cybernews.com/feed/");
  return parseRSS(xml).map((i) => formatItem(i, "Cybernews"));
}

async function fetchHealthcare() {
  const xml = await fetchWithTimeout("https://www.healthcareitnews.com/home/feed");
  return parseRSS(xml).map((i) => formatItem(i, "Healthcare"));
}

async function fetchEducation() {
  const xml = await fetchWithTimeout("https://www.insidehighered.com/rss/news");
  return parseRSS(xml).map((i) => formatItem(i, "Education"));
}

async function fetchEnvironment() {
  const xml = await fetchWithTimeout("https://www.theguardian.com/environment/rss");
  return parseRSS(xml).map((i) => formatItem(i, "Environment"));
}

async function fetchPolitics() {
  const xml = await fetchWithTimeout("https://www.politico.com/rss/politics08.xml");
  return parseRSS(xml).map((i) => formatItem(i, "Politics"));
}

async function fetchTravel() {
  const xml = await fetchWithTimeout("https://www.travelandleisure.com/rss");
  return parseRSS(xml).map((i) => formatItem(i, "Travel"));
}

// ===== Main handler =====
exports.handler = async function () {
  try {
    const results = await Promise.allSettled([
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
    ]);

    const trends = results
      .filter((r) => r.status === "fulfilled")
      .flatMap((r) => r.value);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, trends }),
    };
  } catch (e) {
    console.error("Fatal error in fetch-trends:", e.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: e.message }),
    };
  }
};
