// netlify/functions/fetch-trends.js
const fetch = require("node-fetch");
const { XMLParser } = require("fast-xml-parser");

// ===== Helpers =====
function normalizeItem(item, sourceName) {
  return {
    title:
      item.title?.toString() ||
      item["media:title"]?.toString() ||
      "Untitled",
    link:
      (typeof item.link === "string" ? item.link : item.link?.href) ||
      item.id ||
      "#",
    published: item.pubDate || item.published || item.updated || null,
    source: sourceName,
  };
}

async function fetchRSS(url, sourceName) {
  try {
    const res = await fetch(url, { timeout: 10000 });
    const text = await res.text();

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
    });
    const parsed = parser.parse(text);

    let items = [];

    // RSS
    if (parsed?.rss?.channel?.item) {
      items = parsed.rss.channel.item.map((it) =>
        normalizeItem(it, sourceName)
      );
    }
    // Atom
    else if (parsed?.feed?.entry) {
      items = parsed.feed.entry.map((it) =>
        normalizeItem(
          {
            title: it.title,
            link: it.link?.href || it.id,
            pubDate: it.updated,
          },
          sourceName
        )
      );
    }

    return items;
  } catch (err) {
    console.error(`❌ Lỗi khi fetch ${sourceName}:`, err.message);
    return [];
  }
}

// ===== Individual fetch functions =====
const fetchHackerNewsFrontpage = () =>
  fetchRSS("https://hnrss.org/frontpage", "Hacker News");

const fetchTheVerge = () =>
  fetchRSS("https://www.theverge.com/rss/index.xml", "The Verge");

const fetchIGNGaming = () =>
  fetchRSS("https://feeds.ign.com/ign/games-all", "IGN Gaming");

const fetchVentureBeatAI = () =>
  fetchRSS("https://venturebeat.com/category/ai/feed/", "VentureBeat AI");

const fetchMITTech = () =>
  fetchRSS("https://www.technologyreview.com/feed/", "MIT Tech Review");

const fetchGoogleNewsVN = () =>
  fetchRSS(
    "https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi",
    "Google News VN"
  );

const fetchYahooFinance = () =>
  fetchRSS("https://finance.yahoo.com/news/rss", "Yahoo Finance");

const fetchCNBCFinance = () =>
  fetchRSS("https://www.cnbc.com/id/10000664/device/rss/rss.html", "CNBC Finance");

const fetchScienceMagazine = () =>
  fetchRSS("https://www.sciencemag.org/rss/news_current.xml", "Science Magazine");

const fetchNewScientist = () =>
  fetchRSS("https://www.newscientist.com/feed/home/", "New Scientist");

const fetchAppleMusicMostPlayedVN = () =>
  fetchRSS(
    "https://rss.applemarketingtools.com/api/v2/vn/music/most-played/10/songs.rss",
    "Apple Music Most Played VN"
  );

const fetchAppleMusicNewReleasesVN = () =>
  fetchRSS(
    "https://rss.applemarketingtools.com/api/v2/vn/music/new-releases/10/albums.rss",
    "Apple Music New Releases VN"
  );

const fetchYouTubeTrendingVN = () =>
  fetchRSS(
    "https://www.youtube.com/feeds/videos.xml?playlist_id=PL5d1KNNFArxxwCJAFMdG8sSUxFuFQO6hx",
    "YouTube Trending VN"
  );

const fetchVariety = () => fetchRSS("https://variety.com/feed/", "Variety");

const fetchDeadline = () => fetchRSS("https://deadline.com/feed/", "Deadline");

const fetchGameKVN = () => fetchRSS("https://gamek.vn/home.rss", "GameK VN");

const fetchZingNewsEntertainment = () =>
  fetchRSS("https://zingnews.vn/rss/giai-tri.rss", "ZingNews Entertainment");

const fetchBBCWorld = () =>
  fetchRSS("http://feeds.bbci.co.uk/news/world/rss.xml", "BBC World");

const fetchESPN = () => fetchRSS("https://www.espn.com/espn/rss/news", "ESPN");

const fetchLogistics = () =>
  fetchRSS("https://www.supplychaindigital.com/rss", "Logistics");

const fetchCybernews = () => fetchRSS("https://cybernews.com/feed/", "Cybernews");

const fetchHealthcare = () =>
  fetchRSS("https://www.healthcareitnews.com/rss.xml", "Healthcare");

const fetchEducation = () =>
  fetchRSS("https://www.chronicle.com/section/News/6/rss", "Education");

const fetchEnvironment = () =>
  fetchRSS("https://www.theguardian.com/environment/rss", "Environment");

const fetchPolitics = () =>
  fetchRSS("https://www.politico.com/rss/politics08.xml", "Politics");

const fetchTravel = () =>
  fetchRSS("https://www.travelandleisure.com/rss", "Travel");

// ===== Main handler =====
exports.handler = async function () {
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

  // Gom dữ liệu hợp lệ
  const trends = results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value);

  return {
    statusCode: 200,
    body: JSON.stringify(trends, null, 2),
  };
};
