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
    const [hackerNews, bbcWorld, vnexpressIntl, tiktok, instagram] = await Promise.all([
      fetchHackerNewsFrontpage(),
      fetchBBCWorld(),
      fetchVnExpressInternational(),
      fetchTikTokTrends(),
      fetchInstagramTrends()
    ]);

    // Normalize metrics: prefer views/engagement, fallback votes
    let trends = [...hackerNews, ...bbcWorld, ...vnexpressIntl, ...tiktok, ...instagram]
      .filter(Boolean)
      .map(t => ({
        ...t,
        views: Number.isFinite(Number(t.views)) ? Number(t.views) : undefined,
        engagement: Number.isFinite(Number(t.engagement)) ? Number(t.engagement) : undefined,
        votes: Number.isFinite(Number(t.votes)) ? Number(t.votes) : 0
      }))
      .sort((a, b) => ((Number(b.views)||Number(b.engagement)||Number(b.votes)||0) - (Number(a.views)||Number(a.engagement)||Number(a.votes)||0)));

    // Assign incremental ids to avoid collisions
    trends = trends.map((t, i) => ({ ...t, id: i + 1 }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, trends, sources: {
        hackerNews: hackerNews.length,
        bbcWorld: bbcWorld.length,
        vnexpressIntl: vnexpressIntl.length,
        tiktok: tiktok.length,
        instagram: instagram.length
      } })
    };
  } catch (error) {
    console.error('fetch-trends error', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Failed to fetch live trends', message: error.message })
    };
  }
};

// Removed Reddit: we only keep TikTok, Instagram, and hot news

async function fetchHackerNewsFrontpage() {
  try {
    const url = 'https://hnrss.org/frontpage';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HackerNews HTTP ${res.status}`);
    const xml = await res.text();

    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 50;
    while ((match = itemRegex.exec(xml)) && items.length < 25) {
      const block = match[1];
      const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || block.match(/<title>(.*?)<\/title>/) || [])[1] || 'Hacker News';
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || new Date().toUTCString();
     const description = (
            block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) 
            || block.match(/<description>(.*?)<\/description>/) 
            || []
      )[1] || '';

      items.push({
        title,
        description,
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

// Fetch BBC World News RSS
async function fetchBBCWorld() {
  try {
    const url = 'https://feeds.bbci.co.uk/news/world/rss.xml';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`BBC HTTP ${res.status}`);
    const xml = await res.text();

    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 100;
    while ((match = itemRegex.exec(xml)) && items.length < 25) {
      const block = match[1];
      const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || block.match(/<title>(.*?)<\/title>/) || [])[1] || 'BBC News';
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || new Date().toUTCString();
      const description = (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || block.match(/<description>(.*?)<\/description>/) || [] )[1] || '';

      items.push({
        title,
        description,
        category: 'Worlds',
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
      const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || block.match(/<title>(.*?)<\/title>/) || [])[1] || 'VnExpress News';
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || new Date().toUTCString();
      const description = (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || block.match(/<description>(.*?)<\/description>/) || [])[1] || '';
      items.push({
        title,
        description,
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

async function fetchTikTokTrends() {
  try {
    const res = await fetch('https://tiktok-scraper7.p.rapidapi.com/?url=https%3A%2F%2Fwww.tiktok.com%2F%40tiktok%2Fvideo%2F7516594811734854943&hd=1', {
      headers: {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com'
      }
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`TikTok HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const items = [];

    if (data?.data) {
      items.push(...data.data.map((item, i) => ({
        id: `tiktok-${i}`,
        title: item.title || item.desc || 'No title',
        source: 'TikTok',
        url: item.url || '#',
        views: item.playCount || 0,
        engagement: item.diggCount || 0,
        votes: 0,
        date: new Date(item.createTime * 1000).toLocaleDateString('en-US')
      })));
    }

    return items; 
  } catch (err) {
    console.warn('TikTok fetch error:', err.message);
    return [];
  }
}


async function fetchInstagramTrends() {
  try {
    const res = await fetch('https://instagram-scraper-20231.p.rapidapi.com/top-posts?hashtag=trending', {
      method: 'GET',
      headers: {
        'x-rapidapi-host': 'instagram-scraper-20231.p.rapidapi.com',
        'x-rapidapi-key': process.env.RAPIDAPI_KEY
      }
    });

    if (!res.ok) throw new Error(`Instagram HTTP ${res.status}`);
    const data = await res.json();

    // Normalize
    return (data.data || []).map((item, i) => ({
      source: 'Instagram',
      title: item.caption || 'Instagram Post',
      url: `https://www.instagram.com/p/${item.shortcode}`,
      views: item.play_count || item.view_count || 0,   
      engagement: item.like_count || item.comments_count || 0,
      votes: 0,
      date: new Date(item.taken_at_timestamp * 1000).toLocaleDateString('en-US')
    }));
  } catch (err) {
    console.warn("Instagram fetch failed", err.message);
    return [];
  }
}
