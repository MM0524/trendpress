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


// fetch-trends.js — FULL aggregate (VN-focused) with Reddit + Twitter (trends24)

// Polyfill fetch cho môi trường Node < 18 (Netlify Functions thường ok, nhưng để chắc ăn)
const fetch =
  globalThis.fetch ||
  ((...args) => import("node-fetch").then(({ default: f }) => f(...args)));

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

const FACEBOOK_PAGE = process.env.FACEBOOK_PAGE || "cnn"; // thay bằng 'vtv24', 'zingnews',...

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
      ignGaming,
      ventureBeatAI,
      youtubeTrendingVN,
      googleNewsVN,
      facebookPublic,
      redditTrends,
      twitterTrendsVN,
    ] = await Promise.all([
      fetchHackerNewsFrontpage(),
      fetchBBCWorld(),
      fetchVnExpressInternational(),
      fetchYahooFinance(),
      fetchAppleMusicTopSongsVN(),
      fetchVariety(),
      fetchIGNGaming(),
      fetchVentureBeatAI(),
      fetchYouTubeTrendingVN(),
      fetchGoogleNewsVN(),
      fetchFacebookPublic(FACEBOOK_PAGE),
      fetchRedditTrends(), // pullpush → fallback Reddit RSS
      fetchTwitterTrendsVN(), // parse trends24.in HTML
    ]);

    // Gom tất cả & chuẩn hoá metric
    let trends = [
      ...hackerNews,
      ...bbcWorld,
      ...vnexpressIntl,
      ...yahooFinance,
      ...appleMusic,
      ...variety,
      ...ignGaming,
      ...ventureBeatAI,
      ...youtubeTrendingVN,
      ...googleNewsVN,
      ...facebookPublic,
      ...redditTrends,
      ...twitterTrendsVN,
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
          (Number(a.views) ||
            Number(a.engagement) ||
            Number(a.votes) ||
            0)
      );

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
          appleMusic: appleMusic.length,
          variety: variety.length,
          ignGaming: ignGaming.length,
          ventureBeatAI: ventureBeatAI.length,
          youtubeTrendingVN: youtubeTrendingVN.length,
          googleNewsVN: googleNewsVN.length,
          facebookPublic: facebookPublic.length,
          redditTrends: redditTrends.length,
          twitterTrendsVN: twitterTrendsVN.length,
        },
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

/* ---------------------------
   Helpers
----------------------------*/

function decodeHtmlEntities(str = "") {
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(html = "") {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function safeDateToStr(d) {
  try {
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return new Date().toLocaleDateString("en-US");
    return dt.toLocaleDateString("en-US");
  } catch {
    return new Date().toLocaleDateString("en-US");
  }
}

function parseRss(xml, { category, tags = [], submitter, rankStart = 200, limit = 25 }) {
  const items = [];
  const itemRegex = /<item\b[\s\S]*?>[\s\S]*?<\/item>/gi;
  let match;
  let rank = rankStart;

  while ((match = itemRegex.exec(xml)) && items.length < limit) {
    const block = match[0];

    const pick = (regexes) => {
      for (const r of regexes) {
        const m = block.match(r);
        if (m) return m[1];
      }
      return "";
    };

    let title = pick([
      /<title><!\[CDATA\[(.*?)\]\]><\/title>/i,
      /<title>([\s\S]*?)<\/title>/i,
    ]);
    let link = pick([/<link>([\s\S]*?)<\/link>/i, /<guid>([\s\S]*?)<\/guid>/i]);
    let description = pick([
      /<description><!\[CDATA\[(.*?)\]\]><\/description>/i,
      /<description>([\s\S]*?)<\/description>/i,
      /<content:encoded><!\[CDATA\[(.*?)\]\]><\/content:encoded>/i,
    ]);
    let pubDate = pick([
      /<pubDate>([\s\S]*?)<\/pubDate>/i,
      /<updated>([\s\S]*?)<\/updated>/i,
      /<dc:date>([\s\S]*?)<\/dc:date>/i,
    ]);

    title = decodeHtmlEntities(stripTags(title) || "Untitled");
    description = decodeHtmlEntities(stripTags(description || ""));
    link = decodeHtmlEntities((link || "").trim());

    items.push({
      title,
      description,
      category,
      tags,
      votes: rank--,
      source: link || "#",
      date: safeDateToStr(pubDate || new Date()),
      submitter,
    });
  }
  return items;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "*/*" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.text();
}

/* ---------------------------
   Sources (News/Tech/Finance/Entertainment)
----------------------------*/

async function fetchHackerNewsFrontpage() {
  try {
    const xml = await fetchText("https://hnrss.org/frontpage");
    return parseRss(xml, {
      category: "Tech",
      tags: ["HackerNews"],
      submitter: "Hacker News Frontpage",
      rankStart: 500,
      limit: 25,
    });
  } catch (e) {
    console.warn("HackerNews failed:", e.message);
    return [];
  }
}

async function fetchBBCWorld() {
  try {
    const xml = await fetchText("https://feeds.bbci.co.uk/news/world/rss.xml");
    return parseRss(xml, {
      category: "World",
      tags: ["BBCWorld"],
      submitter: "BBC World News",
      rankStart: 300,
      limit: 25,
    });
  } catch (e) {
    console.warn("BBC World failed:", e.message);
    return [];
  }
}

async function fetchVnExpressInternational() {
  try {
    const xml = await fetchText("https://e.vnexpress.net/rss/news.rss");
    return parseRss(xml, {
      category: "News",
      tags: ["VnExpress"],
      submitter: "VnExpress International",
      rankStart: 400,
      limit: 25,
    });
  } catch (e) {
    console.warn("VnExpress failed:", e.message);
    return [];
  }
}

async function fetchYahooFinance() {
  try {
    const xml = await fetchText("https://finance.yahoo.com/news/rss");
    return parseRss(xml, {
      category: "Finance",
      tags: ["YahooFinance"],
      submitter: "Yahoo Finance",
      rankStart: 260,
      limit: 25,
    });
  } catch (e) {
    console.warn("Yahoo Finance failed:", e.message);
    return [];
  }
}

async function fetchAppleMusicTopSongsVN() {
  try {
    const xml = await fetchText(
      "https://itunes.apple.com/vn/rss/topsongs/limit=25/xml"
    );
    // iTunes RSS thường không có <pubDate> → vẫn parse được
    const items = parseRss(xml, {
      category: "Music",
      tags: ["AppleMusic", "VN"],
      submitter: "Apple Music VN",
      rankStart: 350,
      limit: 25,
    });

    // Bổ sung nghệ sĩ nếu có trong title/description
    return items.map((it) => ({
      ...it,
      title: it.title,
      description: it.description || "Top song in Vietnam on Apple Music",
    }));
  } catch (e) {
    console.warn("Apple Music failed:", e.message);
    return [];
  }
}

async function fetchVariety() {
  try {
    const xml = await fetchText("https://variety.com/feed/");
    return parseRss(xml, {
      category: "Media",
      tags: ["Variety"],
      submitter: "Variety",
      rankStart: 240,
      limit: 25,
    });
  } catch (e) {
    console.warn("Variety failed:", e.message);
    return [];
  }
}

async function fetchIGNGaming() {
  try {
    const xml = await fetchText("https://feeds.ign.com/ign/games-articles");
    return parseRss(xml, {
      category: "Gaming",
      tags: ["IGN"],
      submitter: "IGN Gaming",
      rankStart: 320,
      limit: 25,
    });
  } catch (e) {
    console.warn("IGN Gaming failed:", e.message);
    return [];
  }
}

async function fetchVentureBeatAI() {
  try {
    const xml = await fetchText("https://venturebeat.com/category/ai/feed/");
    return parseRss(xml, {
      category: "AI",
      tags: ["VentureBeat", "AI"],
      submitter: "VentureBeat AI",
      rankStart: 280,
      limit: 25,
    });
  } catch (e) {
    console.warn("VentureBeat AI failed:", e.message);
    return [];
  }
}

async function fetchYouTubeTrendingVN() {
  try {
    const xml = await fetchText(
      "https://www.youtube.com/feeds/videos.xml?chart=mostPopular&regionCode=VN"
    );
    // YouTube Atom feed dùng <entry> thay vì <item>, nhưng vẫn có nhiều site mirror dùng <item>.
    // parseRss sẽ bắt được <item> nếu có; nếu không, ta parse entry thủ công:
    let items = parseRss(xml, {
      category: "YouTube",
      tags: ["YouTube", "VN"],
      submitter: "YouTube Trending VN",
      rankStart: 420,
      limit: 25,
    });

    if (!items.length) {
      // Fallback parse <entry>
      const entries = [];
      const entryRegex = /<entry\b[\s\S]*?>[\s\S]*?<\/entry>/gi;
      let m;
      let rank = 420;
      while ((m = entryRegex.exec(xml)) && entries.length < 25) {
        const block = m[0];
        const title =
          stripTags(
            decodeHtmlEntities(
              (block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || ""
            )
          ) || "YouTube Video";
        const link =
          (block.match(/<link[^>]+href="([^"]+)"/i) || [])[1] || "#";
        const updated =
          (block.match(/<updated>([\s\S]*?)<\/updated>/i) || [])[1] || "";
        const desc =
          stripTags(
            decodeHtmlEntities(
              (block.match(/<media:description>([\s\S]*?)<\/media:description>/i) ||
                [])[1] || ""
            )
          ) || "Trending on YouTube VN";
        entries.push({
          title,
          description: desc,
          category: "YouTube",
          tags: ["YouTube", "VN"],
          votes: rank--,
          source: link,
          date: safeDateToStr(updated),
          submitter: "YouTube Trending VN",
        });
      }
      items = entries;
    }
    return items;
  } catch (e) {
    console.warn("YouTube Trending VN failed:", e.message);
    return [];
  }
}

async function fetchGoogleNewsVN() {
  try {
    const xml = await fetchText(
      "https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi"
    );
    return parseRss(xml, {
      category: "News",
      tags: ["GoogleNews", "VN"],
      submitter: "Google News VN",
      rankStart: 370,
      limit: 25,
    });
  } catch (e) {
    console.warn("Google News VN failed:", e.message);
    return [];
  }
}

async function fetchFacebookPublic(page = "cnn") {
  try {
    const url = `https://rsshub.app/facebook/page/${encodeURIComponent(page)}`;
    const xml = await fetchText(url);
    return parseRss(xml, {
      category: "Social",
      tags: ["Facebook", page],
      submitter: `Facebook Page: ${page}`,
      rankStart: 200,
      limit: 20,
    });
  } catch (e) {
    console.warn("Facebook (RSSHub) failed:", e.message);
    return [];
  }
}

/* ---------------------------
   Reddit (pullpush → fallback Reddit RSS)
----------------------------*/

async function fetchRedditTrends() {
  // 1) ưu tiên pullpush.io (mirror pushshift) — free
  try {
    const url =
      "https://api.pullpush.io/reddit/search/submission/?q=*&size=20&sort=desc&sort_type=score&after=7d";
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`pullpush HTTP ${res.status}`);
    const json = await res.json();
    const list = json?.data || json?.results || [];
    const rankStart = 340;
    let rank = rankStart;
    const items = list.slice(0, 20).map((p) => {
      const title = decodeHtmlEntities(stripTags(p.title || "Reddit Post"));
      const link =
        p.full_link ||
        (p.permalink ? `https://www.reddit.com${p.permalink}` : "#");
      const desc = decodeHtmlEntities(
        stripTags(p.selftext || p.url || "Trending on Reddit")
      );
      const date = p.created_utc
        ? safeDateToStr(new Date(p.created_utc * 1000))
        : safeDateToStr(new Date());
      return {
        title,
        description: desc,
        category: "Social",
        tags: ["Reddit", p.subreddit || "r/all"],
        votes: rank--,
        source: link,
        date,
        submitter: p.subreddit ? `r/${p.subreddit}` : "Reddit",
      };
    });
    if (items.length) return items;
    // nếu rỗng → rơi xuống fallback
    throw new Error("pullpush returned empty");
  } catch (e) {
    console.warn("Reddit pullpush failed, fallback RSS:", e.message);
  }

  // 2) fallback: Reddit RSS r/all
  try {
    const xml = await fetchText("https://www.reddit.com/r/all/.rss?limit=20");
    return parseRss(xml, {
      category: "Social",
      tags: ["Reddit", "r/all"],
      submitter: "Reddit r/all",
      rankStart: 330,
      limit: 20,
    });
  } catch (e) {
    console.warn("Reddit RSS failed:", e.message);
    return [];
  }
}

/* ---------------------------
   Twitter (X) VN via trends24.in (parse HTML)
----------------------------*/

async function fetchTwitterTrendsVN() {
  try {
    const html = await fetchText("https://trends24.in/vietnam/");
    // trends24 cấu trúc: nhiều <ol class="trend-card__list"> ... <li><a href="...">#topic</a></li>
    const listsRegex = /<ol class="trend-card__list">([\s\S]*?)<\/ol>/gi;
    const items = [];
    const seen = new Set();
    let m;
    let rank = 360;
    while ((m = listsRegex.exec(html)) && items.length < 25) {
      const listHtml = m[1];
      const liRegex =
        /<li[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/li>/gi;
      let lm;
      while ((lm = liRegex.exec(listHtml)) && items.length < 25) {
        let link = lm[1];
        let text = stripTags(decodeHtmlEntities(lm[2] || "")).trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        if (!/^https?:\/\//i.test(link)) {
          // trends24 đôi khi để link tương đối -> convert
          link = `https://twitter.com${link}`;
        }
        items.push({
          title: text,
          description: "Trending on X (Twitter) — Vietnam",
          category: "Social",
          tags: ["Twitter", "VN"],
          votes: rank--,
          source: link,
          date: safeDateToStr(new Date()),
          submitter: "Trends24 Vietnam",
        });
      }
    }
    return items;
  } catch (e) {
    console.warn("Twitter (trends24) failed:", e.message);
    return [];
  }
}
