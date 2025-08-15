// Aggregate live trends from multiple sources (Reddit, Hacker News, optional TikTok/Instagram via RapidAPI)
// Returns a unified list matching the app's trend schema

// Require environment variable in production; no hard-coded default
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
    const [hackerNews, googleNews, vnexpressIntl, tiktok, instagram] = await Promise.all([
      fetchHackerNewsFrontPage(),
      fetchGoogleNewsTop(),
      fetchVnExpressInternational(),
      fetchTikTokTrends(),
      fetchInstagramTrends()
    ]);

    // Normalize metrics: prefer views/engagement, fallback votes
    let trends = [...hackerNews, ...googleNews, ...vnexpressIntl, ...tiktok, ...instagram]
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

async function fetchHackerNewsFrontPage() {
  try {
    const res = await fetch('https://hn.algolia.com/api/v1/search?tags=front_page');
    if (!res.ok) throw new Error(`HN HTTP ${res.status}`);
    const json = await res.json();
    const items = (json?.hits || []).map((hit) => ({
      title: hit.title || hit.story_title,
      description: hit.url || hit.story_url || 'Hacker News front page',
      category: 'News',
      tags: ['HackerNews'],
      votes: hit.points || 0,
      source: hit.url || hit.story_url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      date: new Date(hit.created_at).toLocaleDateString('en-US'),
      submitter: hit.author ? `hn/${hit.author}` : 'hn'
    }));
    return items;
  } catch (e) {
    console.warn('HN fetch failed', e.message);
    return [];
  }
}

async function fetchGoogleNewsTop() {
  try {
    const url = 'https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Google News HTTP ${res.status}`);
    const xml = await res.text();
    // Very simple RSS parsing
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let rank = 100; // pseudo votes decreasing by rank
    while ((match = itemRegex.exec(xml)) && items.length < 25) {
      const block = match[1];
      const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || block.match(/<title>(.*?)<\/title>/) || [])[1] || 'News';
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || new Date().toUTCString();
      items.push({
        title,
        description: title,
        category: 'News',
        tags: ['GoogleNews'],
        votes: rank--, // decreasing score so earlier items rank higher
        source: link,
        date: new Date(pubDate).toLocaleDateString('en-US'),
        submitter: 'GoogleNews'
      });
    }
    return items;
  } catch (e) {
    console.warn('Google News fetch failed', e.message);
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
    let rank = 200; // cao hơn Google News để ưu tiên
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

async function fetchTikTokTrends() {
  if (!RAPIDAPI_KEY) return [];
  try {
    // Example RapidAPI endpoint (may vary based on the subscription used)
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
    // Example RapidAPI endpoint for Instagram post search/trending (placeholder, may differ based on provider)
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
