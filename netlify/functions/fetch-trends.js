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
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // chạy song song tất cả nguồn
    const [hackerNews, bbcWorld, vnexpressIntl, aiNews, yahooFinance] = await Promise.allSettled([
      fetchHackerNewsFrontpage(),
      fetchBBCWorld(),
      fetchVnExpressInternational(),
      fetchAINews(),
      fetchYahooFinance()
    ]);

    let trends = [
      ...(hackerNews.status === 'fulfilled' ? hackerNews.value : []),
      ...(bbcWorld.status === 'fulfilled' ? bbcWorld.value : []),
      ...(vnexpressIntl.status === 'fulfilled' ? vnexpressIntl.value : []),
      ...(aiNews.status === 'fulfilled' ? aiNews.value : []),
      ...(yahooFinance.status === 'fulfilled' ? yahooFinance.value : [])
    ];

    // Normalize metrics
    trends = trends
      .filter(Boolean)
      .map(t => ({
        ...t,
        views: Number.isFinite(Number(t.views)) ? Number(t.views) : undefined,
        engagement: Number.isFinite(Number(t.engagement)) ? Number(t.engagement) : undefined,
        votes: Number.isFinite(Number(t.votes)) ? Number(t.votes) : 0
      }))
      .sort((a, b) =>
        (Number(b.views) || Number(b.engagement) || Number(b.votes) || 0) -
        (Number(a.views) || Number(a.engagement) || Number(a.votes) || 0)
      )
      .map((t, i) => ({ ...t, id: i + 1 }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        count: trends.length,
        trends
      })
    };
  } catch (error) {
    console.error('fetch-trends error', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};

// ==================== SOURCES ====================

// Hacker News
async function fetchHackerNewsFrontpage() {
  try {
    const res = await fetchWithTimeout('https://hnrss.org/frontpage');
    const xml = await res.text();
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 500;

    while ((match = itemRegex.exec(xml)) && items.length < 25) {
      const block = match[1];
      const title =
        (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
          block.match(/<title>(.*?)<\/title>/) || [])[1] || 'Hacker News';
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      const pubDate =
        (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] ||
        new Date().toUTCString();
      const description =
        (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
          block.match(/<description>(.*?)<\/description>/) || [])[1] || '';

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
    console.warn('HackerNews fetch failed', e.message);
    return [];
  }
}

// BBC World
async function fetchBBCWorld() {
  try {
    const res = await fetchWithTimeout('https://feeds.bbci.co.uk/news/world/rss.xml');
    const xml = await res.text();
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 180;

    while ((match = itemRegex.exec(xml)) && items.length < 25) {
      const block = match[1];
      const title =
        (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
          block.match(/<title>(.*?)<\/title>/) || [])[1] || 'BBC News';
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      const pubDate =
        (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] ||
        new Date().toUTCString();
      const description =
        (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
          block.match(/<description>(.*?)<\/description>/) || [])[1] || '';

      items.push({
        title,
        description,
        category: 'World',
        tags: ['BBCWorld'],
        votes: rank--,
        source: link,
        date: new Date(pubDate).toLocaleDateString('en-US'),
        submitter: 'BBC World News'
      });
    }
    return items;
  } catch (e) {
    console.warn('BBC fetch failed', e.message);
    return [];
  }
}

// VnExpress International
async function fetchVnExpressInternational() {
  try {
    const res = await fetchWithTimeout('https://e.vnexpress.net/rss/news.rss');
    const xml = await res.text();
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 200;

    while ((match = itemRegex.exec(xml)) && items.length < 25) {
      const block = match[1];
      const title =
        (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
          block.match(/<title>(.*?)<\/title>/) || [])[1] || 'VnExpress News';
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      const pubDate =
        (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] ||
        new Date().toUTCString();
      const description =
        (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
          block.match(/<description>(.*?)<\/description>/) || [])[1] || '';

      items.push({
        title,
        description,
        category: 'News',
        tags: ['VnExpress'],
        votes: rank--,
        source: link,
        date: new Date(pubDate).toLocaleDateString('en-US'),
        submitter: 'VnExpress International'
      });
    }
    return items;
  } catch (e) {
    console.warn('VnExpress fetch failed', e.message);
    return [];
  }
}

// AI News (VentureBeat AI)
async function fetchAINews() {
  try {
    const res = await fetchWithTimeout('https://venturebeat.com/category/ai/feed/');
    const xml = await res.text();
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 250;

    while ((match = itemRegex.exec(xml)) && items.length < 25) {
      const block = match[1];
      const title =
        (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
          block.match(/<title>(.*?)<\/title>/) || [])[1] || 'AI News';
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      const pubDate =
        (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] ||
        new Date().toUTCString();
      const description =
        (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
          block.match(/<description>(.*?)<\/description>/) || [])[1] || '';

      items.push({
        title,
        description,
        category: 'AI',
        tags: ['Artificial Intelligence'],
        votes: rank--,
        source: link,
        date: new Date(pubDate).toLocaleDateString('en-US'),
        submitter: 'VentureBeat AI'
      });
    }
    return items;
  } catch (e) {
    console.warn('AI News fetch failed', e.message);
    return [];
  }
}

// Yahoo Finance 
async function fetchYahooFinance() {
  try {
    const url = 'https://finance.yahoo.com/news/rssindex';
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });
    if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);
    const xml = await res.text();

    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 300; // ưu tiên vừa phải cho finance

    while ((match = itemRegex.exec(xml)) && items.length < 25) {
      const block = match[1];
      const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) 
                     || block.match(/<title>(.*?)<\/title>/) || [])[1] || 'Yahoo Finance';
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || new Date().toUTCString();
      const description = (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) 
                           || block.match(/<description>(.*?)<\/description>/) || [])[1] || '';

      items.push({
        title,
        description,
        category: 'Finance',
        tags: ['YahooFinance'],
        votes: rank--,
        source: link,
        date: isNaN(new Date(pubDate)) 
              ? new Date().toLocaleDateString('en-US') 
              : new Date(pubDate).toLocaleDateString('en-US'),
        submitter: 'Yahoo Finance News'
      });
    }

    return items;
  } catch (e) {
    console.warn('Yahoo Finance fetch failed', e.message);
    return [];
  }
}
