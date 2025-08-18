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

export const handler = async (event) => {
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
      bbcWorld,
      vnexpressIntl,
      yahooFinance,
      appleMusic,
      varietyMedia,
      ignGaming,
      vbAI
    ] = await Promise.all([
      fetchHackerNewsFrontpage(),
      fetchBBCWorld(),
      fetchVnExpressInternational(),
      fetchYahooFinance(),
      fetchAppleMusic(),
      fetchVarietyMedia(),
      fetchIGNGaming(),
      fetchVentureBeatAI()
    ]);

    let trends = [
      ...hackerNews,
      ...bbcWorld,
      ...vnexpressIntl,
      ...yahooFinance,
      ...appleMusic,
      ...varietyMedia,
      ...ignGaming,
      ...vbAI
    ]
      .filter(Boolean)
      .map(t => ({
        ...t,
        votes: Number.isFinite(Number(t.votes)) ? Number(t.votes) : 0
      }))
      .sort((a, b) => (b.votes || 0) - (a.votes || 0));

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
          varietyMedia: varietyMedia.length,
          ignGaming: ignGaming.length,
          ventureBeatAI: vbAI.length
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

// ============================== SOURCES ==============================

// Tech: Hacker News
async function fetchHackerNewsFrontpage() {
  try {
    const res = await fetch('https://hnrss.org/frontpage');
    if (!res.ok) throw new Error(`HN HTTP ${res.status}`);
    const xml = await res.text();

    const items = [];
    const regex = /<item>([\s\S]*?)<\/item>/g;
    let match, rank = 500;
    while ((match = regex.exec(xml)) && items.length < 20) {
      const block = match[1];
      const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]>/) || [])[1] || '';
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      const desc = (block.match(/<description><!\[CDATA\[(.*?)\]\]>/) || [])[1] || '';
      items.push({
        title, description: desc,
        category: 'Tech', tags: ['HackerNews'],
        votes: rank--, source: link,
        date: new Date().toLocaleDateString('en-US'),
        submitter: 'Hacker News'
      });
    }
    return items;
  } catch { return []; }
}

// World: BBC
async function fetchBBCWorld() {
  try {
    const res = await fetch('https://feeds.bbci.co.uk/news/world/rss.xml');
    if (!res.ok) throw new Error(`BBC HTTP ${res.status}`);
    const xml = await res.text();

    const items = [];
    const regex = /<item>([\s\S]*?)<\/item>/g;
    let match, rank = 300;
    while ((match = regex.exec(xml)) && items.length < 20) {
      const block = match[1];
      const title = (block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/) || [])[1];
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      const desc = (block.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/) || [])[1] || '';
      items.push({
        title, description: desc,
        category: 'World', tags: ['BBC'],
        votes: rank--, source: link,
        date: new Date().toLocaleDateString('en-US'),
        submitter: 'BBC News'
      });
    }
    return items;
  } catch { return []; }
}

// News: VnExpress International
async function fetchVnExpressInternational() {
  try {
    const res = await fetch('https://e.vnexpress.net/rss/news.rss');
    if (!res.ok) throw new Error(`VNE HTTP ${res.status}`);
    const xml = await res.text();

    const items = [];
    const regex = /<item>([\s\S]*?)<\/item>/g;
    let match, rank = 400;
    while ((match = regex.exec(xml)) && items.length < 20) {
      const block = match[1];
      const title = (block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/) || [])[1];
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      const desc = (block.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/) || [])[1] || '';
      items.push({
        title, description: desc,
        category: 'News', tags: ['VnExpress'],
        votes: rank--, source: link,
        date: new Date().toLocaleDateString('en-US'),
        submitter: 'VnExpress'
      });
    }
    return items;
  } catch { return []; }
}

// Finance: Yahoo Finance
async function fetchYahooFinance() {
  try {
    const res = await fetch('https://feeds.finance.yahoo.com/rss/2.0/headline?s=AAPL,MSFT,GOOG,AMZN,TSLA&region=US&lang=en-US');
    if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
    const xml = await res.text();

    const items = [];
    const regex = /<item>([\s\S]*?)<\/item>/g;
    let match, rank = 250;
    while ((match = regex.exec(xml)) && items.length < 20) {
      const block = match[1];
      const title = (block.match(/<title>(.*?)<\/title>/) || [])[1];
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      items.push({
        title, description: '',
        category: 'Finance', tags: ['YahooFinance'],
        votes: rank--, source: link,
        date: new Date().toLocaleDateString('en-US'),
        submitter: 'Yahoo Finance'
      });
    }
    return items;
  } catch { return []; }
}

// Music: Apple Music Top Songs
async function fetchAppleMusic() {
  try {
    const res = await fetch('https://rss.applemarketingtools.com/api/v2/us/music/most-played/10/songs.json');
    if (!res.ok) throw new Error(`Apple HTTP ${res.status}`);
    const data = await res.json();
    return data.feed.results.map((s, i) => ({
      title: s.name,
      description: `${s.artistName}`,
      category: 'Music',
      tags: ['AppleMusic'],
      votes: 150 - i,
      source: s.url,
      date: new Date().toLocaleDateString('en-US'),
      submitter: 'Apple Music'
    }));
  } catch { return []; }
}

// Media: Variety
async function fetchVarietyMedia() {
  try {
    const res = await fetch('https://variety.com/feed/');
    if (!res.ok) throw new Error(`Variety HTTP ${res.status}`);
    const xml = await res.text();

    const items = [];
    const regex = /<item>([\s\S]*?)<\/item>/g;
    let match, rank = 200;
    while ((match = regex.exec(xml)) && items.length < 20) {
      const block = match[1];
      const title = (block.match(/<title>(.*?)<\/title>/) || [])[1];
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      items.push({
        title, description: '',
        category: 'Media',
        tags: ['Variety'],
        votes: rank--, source: link,
        date: new Date().toLocaleDateString('en-US'),
        submitter: 'Variety'
      });
    }
    return items;
  } catch { return []; }
}

// Gaming: IGN
async function fetchIGNGaming() {
  try {
    const res = await fetch('https://feeds.feedburner.com/ign/all');
    if (!res.ok) throw new Error(`IGN HTTP ${res.status}`);
    const xml = await res.text();

    const items = [];
    const regex = /<item>([\s\S]*?)<\/item>/g;
    let match, rank = 100;
    while ((match = regex.exec(xml)) && items.length < 20) {
      const block = match[1];
      const title = (block.match(/<title>(.*?)<\/title>/) || [])[1];
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      items.push({
        title, description: '',
        category: 'Gaming',
        tags: ['IGN'],
        votes: rank--, source: link,
        date: new Date().toLocaleDateString('en-US'),
        submitter: 'IGN'
      });
    }
    return items;
  } catch { return []; }
}

// AI: VentureBeat AI
async function fetchVentureBeatAI() {
  try {
    const res = await fetch('https://venturebeat.com/category/ai/feed/');
    if (!res.ok) throw new Error(`VB HTTP ${res.status}`);
    const xml = await res.text();

    const items = [];
    const regex = /<item>([\s\S]*?)<\/item>/g;
    let match, rank = 120;
    while ((match = regex.exec(xml)) && items.length < 20) {
      const block = match[1];
      const title = (block.match(/<title>(.*?)<\/title>/) || [])[1];
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '#';
      items.push({
        title, description: '',
        category: 'AI',
        tags: ['VentureBeatAI'],
        votes: rank--, source: link,
        date: new Date().toLocaleDateString('en-US'),
        submitter: 'VentureBeat'
      });
    }
    return items;
  } catch { return []; }
}
