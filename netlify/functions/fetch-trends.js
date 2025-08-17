// fetch-trends.js

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
    const [hackerNews, bbcWorld, vnexpressIntl, nasdaqNews] = await Promise.all([
      fetchHackerNewsFrontpage(),
      fetchBBCWorld(),
      fetchVnExpressInternational(),
      fetchNasdaqNews()
    ]);

    // Normalize metrics
    let trends = [...hackerNews, ...bbcWorld, ...vnexpressIntl, ...nasdaqNews]
      .filter(Boolean)
      .map(t => ({
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

// --- Helpers ---

function stripHtml(str = '') {
  return str.replace(/<[^>]+>/g, '').trim();
}

// --- Sources ---

// Hacker News
async function fetchHackerNewsFrontpage() {
  try {
    const url = 'https://hnrss.org/frontpage';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HackerNews HTTP ${res.status}`);
    const xml = await res.text();

    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 500; // thấp hơn VnExpress

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
        (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
          block.match(/<description>(.*?)<\/description>/) ||
          [])[1] || '';

      items.push({
        title,
        description: stripHtml(description),
        category: 'Tech',
        tags: ['HackerNews'],
        votes: rank--,
        source: link,
        date: isNaN(new Date(pubDate))
          ? new Date().toLocaleDateString('en-US')
          : new Date(pubDate).toLocaleDateString('en-US'),
        submitter: 'Hacker News Frontpage'
      });
    }
    return items;
  } catch (e) {
    console.warn('Hacker News fetch failed', e.message);
    return [];
  }
}

// BBC World
async function fetchBBCWorld() {
  try {
    const url = 'https://feeds.bbci.co.uk/news/world/rss.xml';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`BBC HTTP ${res.status}`);
    const xml = await res.text();

    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 180; // thấp hơn VnExpress

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
        (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
          block.match(/<description>(.*?)<\/description>/) ||
          [])[1] || '';

      items.push({
        title,
        description: stripHtml(description),
        category: 'World',
        tags: ['BBCWorld'],
        votes: rank--,
        source: link,
        date: isNaN(new Date(pubDate))
          ? new Date().toLocaleDateString('en-US')
          : new Date(pubDate).toLocaleDateString('en-US'),
        submitter: 'BBC World News'
      });
    }

    return items;
  } catch (e) {
    console.warn('BBC World fetch failed', e.message);
    return [];
  }
}

// VnExpress International
async function fetchVnExpressInternational() {
  try {
    const url = 'https://e.vnexpress.net/rss/news.rss';
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
          [])[1] || 'VnExpress News';
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      const pubDate =
        (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] ||
        new Date().toUTCString();
      const description =
        (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
          block.match(/<description>(.*?)<\/description>/) ||
          [])[1] || '';

      items.push({
        title,
        description: stripHtml(description),
        category: 'News',
        tags: ['VnExpressInternational'],
        votes: rank--,
        source: link,
        date: isNaN(new Date(pubDate))
          ? new Date().toLocaleDateString('en-US')
          : new Date(pubDate).toLocaleDateString('en-US'),
        submitter: 'VnExpress International'
      });
    }
    return items;
  } catch (e) {
    console.warn('VnExpress International fetch failed', e.message);
    return [];
  }
}

// Nasdaq News
async function fetchNasdaqNews() {
  try {
    const url = 'https://www.nasdaq.com/feed/rssoutbound';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Nasdaq HTTP ${res.status}`);
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
          [])[1] || 'Nasdaq News';
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      const pubDate =
        (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] ||
        new Date().toUTCString();
      const description =
        (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
          block.match(/<description>(.*?)<\/description>/) ||
          [])[1] || '';

      items.push({
        title,
        description: stripHtml(description),
        category: 'Finance',
        tags: ['Nasdaq'],
        votes: rank--,
        source: link,
        date: isNaN(new Date(pubDate))
          ? new Date().toLocaleDateString('en-US')
          : new Date(pubDate).toLocaleDateString('en-US'),
        submitter: 'Nasdaq News'
      });
    }

    return items;
  } catch (e) {
    console.warn('Nasdaq fetch failed', e.message);
    return [];
  }
}
