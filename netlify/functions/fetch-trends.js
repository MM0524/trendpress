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
      item.link?.href ||
      item.link ||
      item.id ||
      "#",
    published: item.pubDate || item.published || item.updated || null,
    source: sourceName,
  };
}

async function fetchRSS(source) {
  try {
    const res = await fetch(source.url, { timeout: 10000 });
    const text = await res.text();

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
    });
    const parsed = parser.parse(text);

    let items = [];

    // Kiểu RSS truyền thống
    if (parsed?.rss?.channel?.item) {
      items = parsed.rss.channel.item.map((it) =>
        normalizeItem(it, source.name)
      );
    }
    // Kiểu Atom feed
    else if (parsed?.feed?.entry) {
      items = parsed.feed.entry.map((it) =>
        normalizeItem(
          {
            title: it.title,
            link: it.link?.href || it.id,
            pubDate: it.updated,
          },
          source.name
        )
      );
    }

    return items;
  } catch (err) {
    console.error(`❌ Lỗi khi fetch ${source.name}:`, err.message);
    return [];
  }
}

// ===== Sources =====
const sources = [
  // Tech / AI
  { name: "Hacker News", url: "https://hnrss.org/frontpage", type: "rss" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", type: "rss" },
  { name: "IGN Gaming", url: "https://feeds.ign.com/ign/games-all", type: "rss" },
  { name: "VentureBeat AI", url: "https://venturebeat.com/category/ai/feed/", type: "rss" },
  { name: "MIT Tech Review", url: "https://www.technologyreview.com/feed/", type: "rss" },

  // News / Finance
  { name: "Google News VN", url: "https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi", type: "rss" },
  { name: "Yahoo Finance", url: "https://finance.yahoo.com/news/rss", type: "rss" },
  { name: "CNBC Finance", url: "https://www.cnbc.com/id/10000664/device/rss/rss.html", type: "rss" },

  // Science
  { name: "Science Magazine", url: "https://www.sciencemag.org/rss/news_current.xml", type: "rss" },
  { name: "New Scientist", url: "https://www.newscientist.com/feed/home/", type: "rss" },

  // Music
  { name: "Apple Music Most Played VN", url: "https://rss.applemarketingtools.com/api/v2/vn/music/most-played/10/songs.rss", type: "rss" },
  { name: "Apple Music New Releases VN", url: "https://rss.applemarketingtools.com/api/v2/vn/music/new-releases/10/albums.rss", type: "rss" },

  // Video
  { name: "YouTube Trending VN", url: "https://www.youtube.com/feeds/videos.xml?playlist_id=PL5d1KNNFArxxwCJAFMdG8sSUxFuFQO6hx", type: "rss" },

  // Media & Entertainment
  { name: "Variety", url: "https://variety.com/feed/", type: "rss" },
  { name: "Deadline", url: "https://deadline.com/feed/", type: "rss" },
  { name: "GameK VN", url: "https://gamek.vn/home.rss", type: "rss" },
  { name: "ZingNews Entertainment", url: "https://zingnews.vn/rss/giai-tri.rss", type: "rss" },

  // General News / Sports
  { name: "BBC World", url: "http://feeds.bbci.co.uk/news/world/rss.xml", type: "rss" },
  { name: "ESPN", url: "https://www.espn.com/espn/rss/news", type: "rss" },

  // Other fields
  { name: "Logistics", url: "https://www.supplychaindigital.com/rss", type: "rss" },
  { name: "Cybernews", url: "https://cybernews.com/feed/", type: "rss" },
  { name: "Healthcare", url: "https://www.healthcareitnews.com/rss.xml", type: "rss" },
  { name: "Education", url: "https://www.chronicle.com/section/News/6/rss", type: "rss" },
  { name: "Environment", url: "https://www.theguardian.com/environment/rss", type: "rss" },
  { name: "Politics", url: "https://www.politico.com/rss/politics08.xml", type: "rss" },
  { name: "Travel", url: "https://www.travelandleisure.com/rss", type: "rss" },
];

// ===== Main handler =====
exports.handler = async function () {
  const results = await Promise.all(sources.map(fetchRSS));
  const trends = results.flat();

  return {
    statusCode: 200,
    body: JSON.stringify(trends, null, 2),
  };
};
