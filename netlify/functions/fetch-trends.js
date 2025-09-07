// netlify/functions/fetch-trends.js
const fetch = require("node-fetch");
// No need for XMLParser, crypto, or individual fetch functions here anymore.

// IMPORTANT: This helper must match the one in index.html for preprocessTrends
function calculateHotnessScore(trend, maxValues) {
    const weights = { views: 0.2, interactions: 0.4, searches: 0.3, votes: 0.1 };
    const normViews = (trend.views / maxValues.views) || 0;
    const normInteractions = (trend.interactions / maxValues.interactions) || 0;
    const normSearches = (trend.searches / maxValues.searches) || 0;
    const normVotes = (trend.votes / maxValues.votes) || 0;
    return (normViews * weights.views) + (normInteractions * weights.interactions) + (normSearches * weights.searches) + (normVotes * weights.votes);
}

function preprocessTrends(trends) {
    if (!trends || trends.length === 0) return [];
    
    const maxValues = {
        views: Math.max(1, ...trends.map(trendItem => trendItem.views || 0)),
        interactions: Math.max(1, ...trends.map(trendItem => trendItem.interactions || 0)),
        searches: Math.max(1, ...trends.map(trendItem => trendItem.searches || 0)),
        votes: Math.max(1, ...trends.map(trendItem => trendItem.votes || 0)),
    };
    
    trends.forEach((trendItem, i) => {
        trendItem.hotnessScore = calculateHotnessScore(trendItem, maxValues);
        trendItem.type = trendItem.type || (i % 3 === 0 ? 'topic' : 'query');
    });
    return trends;
}


exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  try {
    const { region, category, timeframe, searchTerm, hashtag } = event.queryStringParameters || {};

    // Call the Builder Function to get the cached (or newly built) master list of trends
    // The Builder function is exposed at /.netlify/builders/trends-builder
    const builderUrl = `${process.env.URL || "http://localhost:8888"}/.netlify/builders/trends-builder`;
    console.log("Calling trends-builder function:", builderUrl);
    
    const builderRes = await fetch(builderUrl);
    
    if (!builderRes.ok) {
        const errorText = await builderRes.text();
        console.error("Error fetching from trends-builder:", builderRes.status, errorText);
        throw new Error(`Failed to fetch master trends list (builder status: ${builderRes.status})`);
    }

    const data = await builderRes.json();
    if (!data.success || !Array.isArray(data.trends)) {
        throw new Error(data.message || "Failed to get valid trends data from builder.");
    }

    // The Builder function already preprocesses, but let's re-apply hotness score calculation
    // to ensure consistency if the builder's preprocessing changes or is minimal.
    // However, for performance, it's better if the builder function sends fully preprocessed trends.
    // For this example, let's trust the builder sends preprocessed trends.
    let allFetchedTrends = preprocessTrends(data.trends);

    // Now, apply client-side filters
    let filteredTrends = allFetchedTrends;

    if (region && region !== "global") {
      filteredTrends = filteredTrends.filter(t => t.region && t.region.toLowerCase() === region.toLowerCase());
    }
    if (category && category !== "All") { 
      filteredTrends = filteredTrends.filter(t => t.category && t.category.toLowerCase() === category.toLowerCase());
    }
    if (timeframe && timeframe !== "all") { // Match timeframe logic from client-side
      const now = new Date();
      let cutoffDate = new Date(now);
      switch (timeframe) {
        case "1h": cutoffDate.setHours(now.getHours() - 1); break;
        case "6h": cutoffDate.setHours(now.getHours() - 6); break;
        case "24h": cutoffDate.setHours(now.getHours() - 24); break;
        case "3d": cutoffDate.setDate(now.getDate() - 3); break;
        case "7d": cutoffDate.setDate(now.getDate() - 7); break;
        case "1m": cutoffDate.setDate(now.getDate() - 30); break;
        case "3m": cutoffDate.setDate(now.getDate() - 90); break;
        case "12m": cutoffDate.setFullYear(now.getFullYear() - 1); break;
      }
      cutoffDate.setHours(0, 0, 0, 0); // Normalize to start of day
      filteredTrends = filteredTrends.filter(t => {
        const trendDate = new Date(t.date);
        trendDate.setHours(0, 0, 0, 0); // Normalize to start of day
        return trendDate >= cutoffDate;
      });
    }
    if (searchTerm) {
      const termLower = searchTerm.toLowerCase();
      filteredTrends = filteredTrends.filter(t =>
        (t.title_en && t.title_en.toLowerCase().includes(termLower)) ||
        (t.description_en && t.description_en.toLowerCase().includes(termLower)) ||
        (t.title_vi && t.title_vi.toLowerCase().includes(termLower)) ||
        (t.description_vi && t.description_vi.toLowerCase().includes(termLower)) ||
        (t.tags && t.tags.some(tag => tag.toLowerCase().includes(termLower)))
      );
    }
    if (hashtag) {
      const hashtagLower = hashtag.toLowerCase();
      filteredTrends = filteredTrends.filter(t =>
        t.tags && t.tags.some(tag => tag.toLowerCase() === hashtagLower)
      );
    }

    filteredTrends = filteredTrends
      .filter(Boolean)
      .sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, trends: filteredTrends }),
    };
  } catch (err) {
    console.error("fetch-trends handler error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: "Failed to fetch trends", message: err.message }),
    };
  }
};
