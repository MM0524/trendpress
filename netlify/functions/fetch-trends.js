// fetch-trends.js

// Environment
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

// --- Helpers ---
const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const safeDateStr = (input) => {
  const d = new Date(input);
  return isNaN(d.getTime())
    ? new Date().toLocaleDateString('en-US')
    : d.toLocaleDateString('en-US');
};

const withTimeout = async (promise, ms = 15000) => {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`Request timed out after ${ms}ms`)), ms);
  });
  try {
    const res = await Promise.race([promise, timeout]);
    return res;
  } finally {
    clearTimeout(t);
  }
};

// --- HTTP defaults (Node 18+ has global fetch) ---
const defaultFetch = (url, opts = {}) =>
  withTimeout(
    fetch(url, {
      // a UA helps with some RSS endpoints
      headers: { 'User-Agent': 'trend-collector/1.0', ...(opts.headers || {}) },
      ...opts,
    })
  );

// --- Handler ---
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const [
      hackerNews,
      bbcWorld,
      vnexpressIntl,
      nasdaqNews,
      tiktok,
      instagram,
    ] = await Promise.all([
      fetchHackerNewsFrontpage(),
      fetchBBCWorld(),
      fetchVnExpressInternational(),
      fetchNasdaqNews(),
      fetchTikTokTrends(),
      fetchInstagramTrends(),
    ]);

    // Merge + normalize
    let trends = [
      ...(hackerNews || []),
      ...(bbcWorld || []),
      ...(vnexpressIntl || []),
      ...(nasdaqNews || []),
      ...(tiktok || []),
      ...(instagram || []),
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
          (Number(b.views) || Number(b.engagement) || Number(b.votes) || 0) -
          (Number(a.views) || Number(a.engagement) || Number(a.votes) || 0)
      );

    // Assign incremental ids while preserving existing origin info
    trends = trends.map((t, i) => ({
      ...t,
      id: t.id || `${(t.platform || t.tags?.[0] || 'item').toString().toLowerCase()}-${i + 1}`,
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        trends,
        sources: {
          hackerNews: hackerNews?.length || 0,
          bbcWorld: bbcWorld?.length || 0,
          vnexpressIntl: vnexpressIntl?.length || 0,
          nasdaqNews: nasdaqNews?.length || 0,
          tiktok: tiktok?.length || 0,
          instagram: instagram?.length || 0,
        },
      }),
    };
  } catch (error) {
    console.error('fetch-trends error', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to fetch live trends',
        message: error.message,
      }),
    };
  }
};

// ------------------- Data Sources -------------------

// Hacker News Frontpage RSS
async function fetchHackerNewsFrontpage() {
  try {
    const url = 'https://hnrss.org/frontpage';
    const res = await defaultFetch(url);
    if (!res.ok) throw new Error(`HackerNews HTTP ${res.status}`);
    const xml = await res.text();

    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 50;
    while ((match = itemRegex.exec(xml)) && items.length < 25) {
      const block = match[1];
      const title =
        (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
          block.match(/<title>(.*?)<\/title>/) ||
          [])[1] || 'Hacker News';
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      const pubDate =
        (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] ||
        new Date().toUTCString();
      const description =
        (
          block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
          block.match(/<description>(.*?)<\/description>/) ||
          []
        )[1] || '';

      items.push({
        title,
        description,
        category: 'Tech',
        tags: ['HackerNews'],
        votes: rank--,
        source: link,
        date: safeDateStr(pubDate),
        submitter: 'Hacker News Frontpage',
        platform: 'HackerNews',
      });
    }
    return items;
  } catch (e) {
    console.warn('Hacker News fetch failed:', e.message);
    return [];
  }
}

// BBC World News RSS
async function fetchBBCWorld() {
  try {
    const url = 'https://feeds.bbci.co.uk/news/world/rss.xml';
    const res = await defaultFetch(url);
    if (!res.ok) throw new Error(`BBC HTTP ${res.status}`);
    const xml = await res.text();

    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 100;
    while ((match = itemRegex.exec(xml)) && items.length < 25) {
      const block = match[1];
      const title =
        (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
          block.match(/<title>(.*?)<\/title>/) ||
          [])[1] || 'BBC News';
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      const pubDate =
        (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] ||
        new Date().toUTCString();
      const description =
        (
          block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
          block.match(/<description>(.*?)<\/description>/) ||
          []
        )[1] || '';

      items.push({
        title,
        description,
        category: 'World',
        tags: ['BBCWorld'],
        votes: rank--,
        source: link,
        date: safeDateStr(pubDate),
        submitter: 'BBC World News',
        platform: 'BBC',
      });
    }

    return items;
  } catch (e) {
    console.warn('BBC World fetch failed:', e.message);
    return [];
  }
}

// VnExpress International RSS
async function fetchVnExpressInternational() {
  try {
    const url = 'https://e.vnexpress.net/rss/news.rss';
    const res = await defaultFetch(url);
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
          [])[1] || 'VnExpress News';
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      const pubDate =
        (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] ||
        new Date().toUTCString();
      const description =
        (
          block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
          block.match(/<description>(.*?)<\/description>/) ||
          []
        )[1] || '';

      items.push({
        title,
        description,
        category: 'News',
        tags: ['VnExpressInternational'],
        votes: rank--,
        source: link,
        date: safeDateStr(pubDate),
        submitter: 'VnExpress International',
        platform: 'VnExpress',
      });
    }
    return items;
  } catch (e) {
    console.warn('VnExpress International fetch failed:', e.message);
    return [];
  }
}

// Nasdaq RSS
async function fetchNasdaqNews() {
  try {
    const url = 'https://www.nasdaq.com/feed/rssoutbound';
    const res = await defaultFetch(url);
    if (!res.ok) throw new Error(`NASDAQ HTTP ${res.status}`);
    const xml = await res.text();

    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 150;
    while ((match = itemRegex.exec(xml)) && items.length < 25) {
      const block = match[1];
      const title =
        (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
          block.match(/<title>(.*?)<\/title>/) ||
          [])[1] || 'NASDAQ News';
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      const pubDate =
        (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] ||
        new Date().toUTCString();
      const description =
        (
          block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
          block.match(/<description>(.*?)<\/description>/) ||
          []
        )[1] || '';

      items.push({
        title,
        description,
        category: 'Stock Market',
        tags: ['NASDAQ'],
        votes: rank--,
        source: link,
        date: safeDateStr(pubDate),
        submitter: 'NASDAQ RSS Feed',
        platform: 'NASDAQ',
      });
    }
    return items;
  } catch (e) {
    console.warn('NASDAQ fetch failed:', e.message);
    return [];
  }
}

// TikTok (RapidAPI)
async function fetchTikTokTrends() {
  try {
    const url =
      'https://tiktok-scraper7.p.rapidapi.com/?url=https%3A%2F%2Fwww.tiktok.com%2F%40tiktok%2Fvideo%2F7516594811734854943&hd=1';

    const res = await defaultFetch(url, {
      headers: {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com',
      },
    });
    if (!res.ok) throw new Error(`TikTok HTTP ${res.status}`);
    const json = await res.json();

    if (!json?.data) return [];
    const arr = Array.isArray(json.data) ? json.data : [json.data];

    return arr.map((v, i) => {
      const title = v.title || v.desc || 'TikTok Video';
      const lower = (title || '').toLowerCase();
      let category = 'General';
      if (lower.includes('dance') || lower.includes('challenge')) category = 'Dance';
      else if (lower.includes('food') || lower.includes('recipe')) category = 'Food';
      else if (lower.includes('fashion') || lower.includes('outfit')) category = 'Fashion';
      else if (lower.includes('music') || lower.includes('song')) category = 'Music';

      return {
        id: `tiktok-${i + 1}`,
        title,
        description: v.desc || '',
        url: v.share_url || v.play || '#',
        views: num(v.play_count, 0),
        engagement: num(v.digg_count ?? v.like_count, 0),
        date: v.create_time
          ? safeDateStr(v.create_time * 1000)
          : safeDateStr(Date.now()),
        votes: 0,
        source: v.share_url || 'https://www.tiktok.com',
        platform: 'TikTok',
        category,
      };
    });
  } catch (err) {
    console.warn('TikTok fetch failed:', err.message);
    return [];
  }
}

// Instagram (RapidAPI)
async function fetchInstagramTrends() {
  try {
    const url =
      'https://instagram-scraper-20231.p.rapidapi.com/top-posts?hashtag=trending';
    const res = await defaultFetch(url, {
      method: 'GET',
      headers: {
        'x-rapidapi-host': 'instagram-scraper-20231.p.rapidapi.com',
        'x-rapidapi-key': RAPIDAPI_KEY,
      },
    });

    if (!res.ok) throw new Error(`Instagram HTTP ${res.status}`);
    const data = await res.json();

    const list = Array.isArray(data?.data) ? data.data : [];
    return list.map((item, i) => ({
      id: `instagram-${i + 1}`,
      source: 'Instagram',
      platform: 'Instagram',
      title: item.caption || 'Instagram Post',
      url: item.shortcode
        ? `https://www.instagram.com/p/${item.shortcode}`
        : '#',
      views: num(item.play_count ?? item.view_count, 0),
      engagement: num(item.like_count ?? item.comments_count, 0),
      votes: 0,
      date: item.taken_at_timestamp
        ? safeDateStr(item.taken_at_timestamp * 1000)
        : safeDateStr(Date.now()),
      category: 'General',
    }));
  } catch (err) {
    console.warn('Instagram fetch failed:', err.message);
    return [];
  }
}
