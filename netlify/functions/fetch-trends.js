// ===============================
// fetch-trends.js
// ===============================

// ---- BACKEND PART (Node/Serverless) ----
const RAPIDAPI_KEY = typeof process !== "undefined" ? process.env.RAPIDAPI_KEY : null;
const GEMINI_API_KEY = typeof process !== "undefined" ? process.env.GEMINI_API_KEY : null;

// Helper functions
const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const safeDateStr = (input) => {
  const d = new Date(input);
  return isNaN(d.getTime())
    ? new Date().toLocaleDateString("en-US")
    : d.toLocaleDateString("en-US");
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

const defaultFetch =
  typeof fetch !== "undefined"
    ? (url, opts = {}) =>
        withTimeout(
          fetch(url, {
            headers: { "User-Agent": "trend-collector/1.0", ...(opts.headers || {}) },
            ...opts,
          })
        )
    : () => Promise.reject(new Error("fetch not available"));

// -------------------- Data Sources --------------------
// (Hacker News, BBC, VNExpress, Nasdaq, TikTok, Instagram giữ nguyên như bạn đã có)

// ... [các hàm fetchHackerNewsFrontpage, fetchBBCWorld, fetchVnExpressInternational, fetchNasdaqNews, fetchTikTokTrends, fetchInstagramTrends giữ nguyên] ...

// -------------------- Serverless Handler --------------------
if (typeof exports !== "undefined") {
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
      const [hackerNews, bbcWorld, vnexpressIntl, nasdaqNews, tiktok, instagram] =
        await Promise.all([
          fetchHackerNewsFrontpage(),
          fetchBBCWorld(),
          fetchVnExpressInternational(),
          fetchNasdaqNews(),
          fetchTikTokTrends(),
          fetchInstagramTrends(),
        ]);

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
          engagement: Number.isFinite(Number(t.engagement)) ? Number(t.engagement) : undefined,
          votes: Number.isFinite(Number(t.votes)) ? Number(t.votes) : 0,
        }))
        .sort(
          (a, b) =>
            (Number(b.views) || Number(b.engagement) || Number(b.votes) || 0) -
            (Number(a.views) || Number(a.engagement) || Number(a.votes) || 0)
        );

      trends = trends.map((t, i) => ({
        ...t,
        id:
          t.id ||
          `${(t.platform || t.tags?.[0] || "item").toString().toLowerCase()}-${i + 1}`,
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
}

// ===============================
// FRONTEND PART (Browser)
// ===============================
if (typeof window !== "undefined") {
  const API_URL = "/.netlify/functions/fetch-trends";
  const trendContainer = document.getElementById("trendContainer");

  // --- Gemini integration ---
  async function analyzeWithGemini(promptText) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY || "YOUR_API_KEY"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }] }],
          }),
        }
      );

      if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
      const data = await res.json();
      const output = data?.candidates?.[0]?.content?.parts?.[0]?.text || "No response";
      return output;
    } catch (err) {
      console.error("Gemini API failed:", err);
      return "⚠️ Failed to analyze with Gemini.";
    }
  }

  async function loadTrends() {
    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      if (!json.success) throw new Error(json.error || "API failed");
      displayTrends(json.trends || []);
    } catch (err) {
      console.error("Load trends failed:", err);
      if (trendContainer) {
        trendContainer.innerHTML = `<p class="error">Failed to load trends</p>`;
      }
    }
  }

  function displayTrends(trends) {
    if (!Array.isArray(trends) || !trendContainer) return;
    trendContainer.innerHTML = "";
    trends.forEach((trend) => {
      if (!trend) return;
      const card = createTrendCard(trend);
      trendContainer.insertAdjacentHTML("beforeend", card);
    });
  }

  function createTrendCard(trend) {
    if (!trend) return "";
    const title = trend.title || "Untitled";
    const description = trend.description || "";
    const source = trend.source || trend.url || "#";
    const platform = trend.platform || (trend.tags ? trend.tags[0] : "General");
    const date = trend.date || "";
    const views = trend.views ?? trend.votes ?? 0;
    const engagement = trend.engagement ?? 0;

    const tags = (trend.tags || [])
      .map((tag) => `<span class="tag">${tag}</span>`)
      .join(" ");

    return `
      <div class="trend-card" data-id="${trend.id}">
        <h3 class="trend-title">${title}</h3>
        <p class="trend-desc">${description}</p>
        <div class="trend-meta">
          <span>${platform}</span> | 
          <span>${date}</span>
        </div>
        <div class="trend-stats">
          👁 ${views} | ❤️ ${engagement}
        </div>
        <div class="trend-tags">${tags}</div>
        <a href="${source}" target="_blank">Read more</a>
        <button class="analyze-btn" data-id="${trend.id}">Analyze</button>
      </div>
    `;
  }

  async function handleTrendListInteraction(event) {
    const card = event.target.closest(".trend-card");
    if (!card) return;
    const id = card.dataset.id;
    if (!id) return;

    const titleEl = card.querySelector(".trend-title");
    const descEl = card.querySelector(".trend-desc");

    // Nếu bấm vô title
    if (event.target.classList.contains("trend-title")) {
      alert(`You clicked: ${titleEl.textContent}`);
    }

    // Nếu bấm vô nút Analyze
    if (event.target.classList.contains("analyze-btn")) {
      const textToAnalyze = `${titleEl?.textContent}\n${descEl?.textContent}`;
      event.target.textContent = "Analyzing...";
      const result = await analyzeWithGemini(textToAnalyze);
      event.target.textContent = "Analyze";
      alert("Gemini Analysis:\n\n" + result);
    }
  }

  if (trendContainer) {
    trendContainer.addEventListener("click", handleTrendListInteraction);
  }
  document.addEventListener("DOMContentLoaded", loadTrends);
}
