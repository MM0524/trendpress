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
      googleNews,
      vnexpressIntl,
      bbcNews,
      nasdaqNews,
      tiktok,
      instagram
    ] = await Promise.all([
      fetchHackerNewsFrontpage(),
      fetchVnExpressInternational(),
      fetchBBCNews(),
      fetchNasdaqNews(),
      fetchTikTokTrends(),
      fetchInstagramTrends()
    ]);

    let trends = [
      ...hackerNews,
      ...vnexpressIntl,
      ...bbcNews,
      ...nasdaqNews,
      ...tiktok,
      ...instagram
    ]
      .filter(Boolean)
      .map(t => ({
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
          nasdaqNews: nasdaqNews.length,
          tiktok: tiktok.length,
          instagram: instagram.length
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

      const link =
        (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
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

      const link =
        (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
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

      const link =
        (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
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
    return items;
  } catch (e) {
    console.warn('BBC News fetch failed', e.message);
    return [];
  }
}

async function fetchNasdaqNews() {
  try {
    const url = 'https://www.nasdaq.com/feed/rssoutbound?category=Market%20News';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Nasdaq News HTTP ${res.status}`);
    const xml = await res.text();
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

      const link =
        (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
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
    return items;
  } catch (e) {
    console.warn('Nasdaq News fetch failed', e.message);
    return [];
  }
}

async function fetchTikTokTrends() {
  if (!RAPIDAPI_KEY) return [];
  try {
    const res = await fetch('https://tiktok-scraper7.p.rapidapi.com/trending', {
      headers: {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com'
      }
    });
    if (!res.ok) throw new Error(`TikTok HTTP ${res.status}`);
    const json = await res.json();
    const list = json?.data || json?.videos || [];
    return list.slice(0, 15).map((v) => ({
      title: v.title || v.desc || `TikTok by @${v?.author?.uniqueId || v?.author || 'creator'}`,
      description: v.desc || 'Trending on TikTok',
      category: 'TikTok',
      tags: (v?.hashtags || v?.challenges || []).map(h => typeof h === 'string' ? h : (h?.title || h?.name)).filter(Boolean),
      engagement: v.stats?.diggCount || v.diggCount || 0,
      views: v.stats?.playCount || v.playCount || undefined,
      source: v.webVideoUrl || v.shareUrl || `https://www.tiktok.com/@${v?.author?.uniqueId || ''}/video/${v?.id || v?.video_id || ''}`,
      date: new Date((v.createTime || v?.timestamp || Date.now()) * 1000).toLocaleDateString('en-US'),
      submitter: v?.author?.uniqueId ? `@${v.author.uniqueId}` : 'tiktok'
    }));
  } catch (e) {
    console.warn('TikTok fetch failed', e.message);
    return [];
  }
}

async function fetchInstagramTrends() {
  if (!RAPIDAPI_KEY) return [];
  try {
    const res = await fetch('https://instagram-scraper-api2.p.rapidapi.com/v1/trending', {
      headers: {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': 'instagram-scraper-api2.p.rapidapi.com'
      }
    });
    if (!res.ok) throw new Error(`Instagram HTTP ${res.status}`);
    const json = await res.json();
    const list = json?.data || json?.items || [];
    return list.slice(0, 15).map((p) => ({
      title: p.caption || p.title || `Instagram by @${p?.username || p?.owner_username || 'creator'}`,
      description: p.caption || 'Trending on Instagram',
      category: 'Instagram',
      tags: (p.hashtags || []).map((h) => (typeof h === 'string' ? h : h?.name)).filter(Boolean),
      engagement: p.like_count || p.likes || 0,
      views: p.view_count || p.play_count || undefined,
      source: p.permalink || p.link || (p.code ? `https://www.instagram.com/p/${p.code}` : '#'),
      date: new Date(p.taken_at_timestamp ? p.taken_at_timestamp * 1000 : Date.now()).toLocaleDateString('en-US'),
      submitter: p.username ? `@${p.username}` : 'instagram'
    }));
  } catch (e) {
    console.warn('Instagram fetch failed', e.message);
    return [];
  }
}
