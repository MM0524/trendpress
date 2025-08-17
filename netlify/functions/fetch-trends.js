// fetch-trends.js

// Polyfill fetch nếu Node < 18
const fetch = global.fetch || ((...args) =>
  import('node-fetch').then(({ default: f }) => f(...args))
);

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const [
      hackerNews,
      vnexpressIntl,
      bbcNews,
      nasdaqNews
    ] = await Promise.all([
      fetchHackerNewsFrontpage(),
      fetchVnExpressInternational(),
      fetchBBCNews(),
      fetchNasdaqNews()
    ]);

    let trends = [
      ...hackerNews,
      ...vnexpressIntl,
      ...bbcNews,
      ...nasdaqNews
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
          (Number(b.views) ||
            Number(b.engagement) ||
            Number(b.votes) ||
            0) -
          (Number(a.views) ||
            Number(a.engagement) ||
            Number(a.votes) ||
            0)
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
          vnexpressIntl: vnexpressIntl.length,
          bbcNews: bbcNews.length,
          nasdaqNews: nasdaqNews.length
        }
      })
    };
  } catch (error) {
    console.error('fetch-trends error', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to fetch live trends',
        message: error.message
      })
    };
  }
};

/* ---------------------------
   Helper
----------------------------*/
function decodeHtmlEntities(str = '') {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function fetchHackerNewsFrontpage() {
  try {
    const url = 'https://hnrss.org/frontpage';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HackerNews HTTP ${res.status}`);
    const xml = await res.text();

    const items = [];
    const itemRegex = /<item[\s\S]*?>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 500;

    while ((match = itemRegex.exec(xml)) && items.length < 25) {
      const block = match[1];
      let title =
        (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
          block.match(/<title>(.*?)<\/title>/) ||
          [])[1] || 'Hacker News';
      title = decodeHtmlEntities(title);

      let description =
        (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
          block.match(/<description>(.*?)<\/description>/) ||
          [])[1] || '';
      description = decodeHtmlEntities(description);

      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      const pubDate =
        (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] ||
        new Date().toUTCString();

      items.push({
        title,
        description,
        category: 'Tech',
        tags: ['HackerNews'],
        votes: rank--,
        source: link,
        date: new Date(pubDate).toLocaleDateString('en-US'),
        submitter: 'Hacker News Frontpage'
      });
    }
    return items;
  } catch (e) {
    console.warn('Hacker News fetch failed', e.message);
    return [];
  }
}

async function fetchVnExpressInternational() {
  try {
    const url = 'https://e.vnexpress.net/rss/news.rss';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`VnExpress HTTP ${res.status}`);
    const xml = await res.text();
    const items = [];
    const itemRegex = /<item[\s\S]*?>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 200;
    while ((match = itemRegex.exec(xml)) && items.length < 25) {
      const block = match[1];
      let title =
        (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
          block.match(/<title>(.*?)<\/title>/) ||
          [])[1] || 'VnExpress News';
      title = decodeHtmlEntities(title);

      let description =
        (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
          block.match(/<description>(.*?)<\/description>/) ||
          [])[1] || '';
      description = decodeHtmlEntities(description);

      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      const pubDate =
        (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] ||
        new Date().toUTCString();
      items.push({
        title,
        description,
        category: 'News',
        tags: ['VnExpressInternational'],
        votes: rank--,
        source: link,
        date: new Date(pubDate).toLocaleDateString('en-US'),
        submitter: 'VnExpress International'
      });
    }
    return items;
  } catch (e) {
    console.warn('VnExpress International fetch failed', e.message);
    return [];
  }
}

async function fetchBBCNews() {
  try {
    const url = 'https://feeds.bbci.co.uk/news/rss.xml';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`BBC News HTTP ${res.status}`);
    const xml = await res.text();

    console.log("BBC xml sample:", xml.slice(0, 200));

    const items = [];
    const itemRegex = /<item[\s\S]*?>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 250;
    while ((match = itemRegex.exec(xml)) && items.length < 25) {
      const block = match[1];
      let title =
        (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
          block.match(/<title>(.*?)<\/title>/) ||
          [])[1] || 'BBC News';
      title = decodeHtmlEntities(title);

      let description =
        (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
          block.match(/<description>(.*?)<\/description>/) ||
          [])[1] || '';
      description = decodeHtmlEntities(description);

      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      const pubDate =
        (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] ||
        new Date().toUTCString();

      items.push({
        title,
        description,
        category: 'News',
        tags: ['BBC'],
        votes: rank--,
        source: link,
        date: new Date(pubDate).toLocaleDateString('en-US'),
        submitter: 'BBC News'
      });
    }

    console.log("BBC items parsed:", items.length);
    return items;
  } catch (e) {
    console.warn('BBC News fetch failed', e.message);
    return [];
  }
}

async function fetchNasdaqNews() {
  try {
    const url = 'https://www.nasdaq.com/feed/rssoutbound';
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (!res.ok) throw new Error(`Nasdaq News HTTP ${res.status}`);
    const xml = await res.text();

    console.log("Nasdaq xml sample:", xml.slice(0, 200));

    const items = [];
    const itemRegex = /<item[\s\S]*?>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 180;
    while ((match = itemRegex.exec(xml)) && items.length < 25) {
      const block = match[1];
      let title =
        (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
          block.match(/<title>(.*?)<\/title>/) ||
          [])[1] || 'Nasdaq News';
      title = decodeHtmlEntities(title);

      let description =
        (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
          block.match(/<description>(.*?)<\/description>/) ||
          [])[1] || '';
      description = decodeHtmlEntities(description);

      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      const pubDate =
        (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] ||
        new Date().toUTCString();

      items.push({
        title,
        description,
        category: 'Finance',
        tags: ['Nasdaq'],
        votes: rank--,
        source: link,
        date: new Date(pubDate).toLocaleDateString('en-US'),
        submitter: 'Nasdaq Market News'
      });
    }

    console.log("Nasdaq items parsed:", items.length);
    return items;
  } catch (e) {
    console.warn('Nasdaq News fetch failed', e.message);
    return [];
  }
}

