import Parser from "rss-parser";

const parser = new Parser();

// ================== Helper Functions ==================
async function fetchWithTimeout(url, options = {}, ms = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch (err) {
    throw new Error(`Timeout or network error for ${url}: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

function toDateStr(date) {
  return date ? new Date(date).toISOString() : new Date().toISOString();
}

function rssItems(xml) {
  return xml.split("<item>").slice(1).map(block => block.split("</item>")[0]);
}

function getTag(block, tag) {
  const regex = new RegExp(`<${tag}.*?>([\\s\\S]*?)<\\/${tag}>`);
  const match = block.match(regex);
  return match ? match[1].trim() : "";
}

// ================== Sources ==================

// Hacker News
async function fetchHackerNewsFrontpage() {
  const res = await fetchWithTimeout("https://hnrss.org/frontpage");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Tech",
    tags: ["HackerNews"],
    votes: 500 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "Hacker News",
  }));
}

// The Verge
async function fetchTheVerge() {
  const res = await fetchWithTimeout("https://www.theverge.com/rss/index.xml");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Tech",
    tags: ["TheVerge"],
    votes: 450 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "The Verge",
  }));
}

// IGN Gaming
async function fetchIGNGaming() {
  const res = await fetchWithTimeout("https://feeds.feedburner.com/ign/games-all");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Gaming",
    tags: ["IGN"],
    votes: 430 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "IGN Gaming",
  }));
}

// VentureBeat AI
async function fetchVentureBeatAI() {
  const res = await fetchWithTimeout("https://venturebeat.com/category/ai/feed/");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "AI",
    tags: ["VentureBeat"],
    votes: 420 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "VentureBeat AI",
  }));
}

// MIT Technology Review
async function fetchMITTech() {
  const res = await fetchWithTimeout("https://www.technologyreview.com/feed/");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "AI",
    tags: ["MITTechReview"],
    votes: 415 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "MIT Tech Review",
  }));
}

// Google News VIETNAM ✅
async function fetchGoogleNewsVN() {
  const res = await fetchWithTimeout("https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "News",
    tags: ["GoogleNewsVN", "Vietnam"],
    votes: 405 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "Google News VN",
  }));
}

// Yahoo Finance
async function fetchYahooFinance() {
  const res = await fetchWithTimeout("https://finance.yahoo.com/news/rssindex");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Finance",
    tags: ["YahooFinance"],
    votes: 395 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "Yahoo Finance",
  }));
}

// CNBC Finance
async function fetchCNBCFinance() {
  const res = await fetchWithTimeout("https://www.cnbc.com/id/10000664/device/rss/rss.html");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Finance",
    tags: ["CNBC"],
    votes: 390 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "CNBC Finance",
  }));
}

// DTCK (Vietnam Stocks)
async function fetchDTCK() {
  const res = await fetchWithTimeout("https://tinnhanhchungkhoan.vn/rss/home.rss");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Finance",
    tags: ["DTCK", "VietnamStocks", "Vietnam"],
    votes: 385 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "DTCK",
  }));
}

// Science Magazine
async function fetchScienceMagazine() {
  const res = await fetchWithTimeout("https://www.sciencemag.org/rss/news_current.xml");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Science",
    tags: ["ScienceMagazine"],
    votes: 370 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "Science Magazine",
  }));
}

// New Scientist
async function fetchNewScientist() {
  const res = await fetchWithTimeout("https://www.newscientist.com/feed/home/");
  if (!res.ok) return [];
  const xml = await res.text();
  return rssItems(xml).map((block, i) => ({
    title: getTag(block, "title"),
    description: getTag(block, "description"),
    category: "Science",
    tags: ["NewScientist"],
    votes: 365 - i,
    source: getTag(block, "link"),
    date: toDateStr(getTag(block, "pubDate")),
    submitter: "New Scientist",
  }));
}

// 🔹 Apple Music Vietnam - New Releases 
async function fetchAppleMusicNewReleasesVN() { 
  const res = await fetchWithTimeout("https://rss.applemarketingtools.com/api/v2/vn/music/new-releases/100/songs.json"); 
  if (!res.ok) return []; const json = await res.json(); 
  return json.feed.results.map((item, i) => ({ 
    title: item.name, description: item.artistName, 
    category: "Music", 
    tags: ["AppleMusic", "Vietnam", "NewReleases"], 
    votes: 480 - i, // cho điểm thấp hơn  
    source: item.url, 
    date: toDateStr(item.releaseDate || new Date().toISOString()), 
    submitter: "Apple Music" 
  })); 
}

async function fetchAppleMusicMostPlayedVN() { 
  const res = await fetchWithTimeout("https://rss.applemarketingtools.com/api/v2/vn/music/most-played/100/songs.json"); 
  if (!res.ok) return []; 
  const json = await res.json(); 
  return json.feed.results.map((item, i) => ({ 
    title: item.name, 
    description: item.artistName, 
    category: "Music", 
    tags: ["AppleMusic", "Vietnam", "MostPlayed"], 
    votes: 500 - i, source: item.url, 
    date: toDateStr(item.releaseDate || new Date().toISOString()), 
    submitter: "Apple Music" 
  })); 
}

// ================== Handler ==================
export async function handler() {
  const sources = [
    fetchHackerNewsFrontpage(),
    fetchTheVerge(),
    fetchIGNGaming(),
    fetchVentureBeatAI(),
    fetchMITTech(),
    fetchGoogleNewsVN(),  
    fetchYahooFinance(),
    fetchCNBCFinance(),
    fetchDTCK(),
    fetchScienceMagazine(),
    fetchNewScientist(),
    fetchAppleMusicNewReleasesVN(),
    fetchAppleMusicMostPlayedVN(),
  ];

  const results = await Promise.allSettled(sources);
  const data = results
    .filter(r => r.status === "fulfilled")
    .flatMap(r => r.value);

  return {
    statusCode: 200,
    body: JSON.stringify(data, null, 2),
  };
}
