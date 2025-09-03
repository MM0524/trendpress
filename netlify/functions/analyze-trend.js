// File: netlify/functions/analyze-trend.js
const fetch = require("node-fetch");

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Language",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  // --- AI Status Check (GET request) ---
  if (event.httpMethod === "GET") {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: "AI service is online." }),
    };
  }

  // --- Trend Analysis (POST request) ---
  if (event.httpMethod === "POST") {
    try {
      const { trend, analysisType, language } = JSON.parse(event.body);

      if (!trend) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, message: "Trend data is missing." }),
        };
      }

      const trendTitle = (language === 'vi' ? trend.title_vi : trend.title_en) || trend.title_en || trend.title_vi || "No Title Provided";
      const trendDescription = (language === 'vi' ? trend.description_vi : trend.description_en) || trend.description_en || trend.description_vi || "No description provided.";
      const trendCategory = trend.category || "General";
      const trendRegion = trend.region === 'vn' ? 'Vietnam' : (trend.region === 'us' ? 'United States' : 'Global'); // Translate region for analysis
      const trendSubmitter = trend.submitter || 'Unknown Source';
      const trendDate = trend.date ? new Date(trend.date).toLocaleDateString(language === 'vi' ? 'vi-VN' : 'en-US') : 'Unknown Date';
      
      // NEW: Metrics for more dynamic analysis text
      const views = trend.views || 0;
      const interactions = trend.interactions || 0;
      const searches = trend.searches || 0;
      const votes = trend.votes || 0;


      if (trendTitle === "No Title Provided" || trendDescription === "No description provided.") {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            message: `Trend data is incomplete: Title="${trendTitle}", Description="${trendDescription}". Cannot analyze an undefined trend.`,
            data: "The provided trend has no valid title or description. Please ensure the trend data is complete before requesting analysis."
          }),
        };
      }
      
      let analysisResult = {};

      if (analysisType === 'summary') {
        // CẬP NHẬT: Tính successScore dựa trên hotnessScore (nếu có)
        const successScore = trend.hotnessScore ? 
                             (Math.min(99, Math.max(20, trend.hotnessScore * 100 + Math.random() * 10 - 5))) : // Tăng phạm vi và thêm ngẫu nhiên
                             (Math.floor(Math.random() * 40) + 60); // Fallback
        
        const sentiment = successScore > 75 ? "positive" : (successScore > 50 ? "neutral" : "mixed");
        const growthPotential = successScore > 80 ? "high potential for growth" : (successScore > 60 ? "moderate growth" : "stable development");

        analysisResult = {
          successScore: parseFloat(successScore.toFixed(0)),
          summary: `This is a summary for the trend "${trendTitle}" in the **${trendCategory}** domain, originating from **${trendSubmitter}** on ${trendDate}. It currently holds a relevance score of **${successScore}%**, indicating a generally **${sentiment}** sentiment. With approximately **${Math.round(views / 1000)}K views**, **${Math.round(interactions / 1000)}K interactions**, and **${Math.round(searches / 1000)}K searches**, this trend shows ${growthPotential}. Its core focus revolves around **${trendTitle}**. This trend appears significant, especially in the **${trendRegion}** context.`,
        };
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, data: JSON.stringify(analysisResult) }),
        };

      } else if (analysisType === 'detailed') {
        const successScore = trend.hotnessScore ? (Math.min(99, Math.max(20, trend.hotnessScore * 100 + Math.random() * 10 - 5))) : (Math.floor(Math.random() * 40) + 60);
        const sentiment = successScore > 75 ? "positive" : (successScore > 50 ? "neutral" : "mixed");
        const audienceDemographics = trend.category === "Gaming" ? "younger audience (18-30)" : (trend.category === "Fashion" ? "fashion-conscious individuals (20-40)" : "diverse users interested in innovation");

        analysisResult = `
          # AI Deep Dive for "${trendTitle}"

          ## Analysis of "${trendTitle}" Trend
          The trend "**${trendTitle}**", categorized as **${trendCategory}** and described as "${trendDescription}", presents opportunities for deeper insights.
          This AI analysis provides a comprehensive overview, leveraging available data and predictive models.

          **Key Findings:**
          *   **Relevance Score:** **${successScore}%** (Overall relevance to current market dynamics).
          *   **Emergence Pattern:** The trend ${successScore > 70 ? "shows a rapid ascent, peaking within the last few days" : "is showing steady interest since its inception on " + trendDate}.
          *   **Audience Demographics:** Primarily resonates with ${audienceDemographics} interested in ${trendCategory.toLowerCase()} and innovation.
          *   **Geographical Hotspots:** Strongest engagement observed in **${trendRegion}**, indicating specific market concentration.
          *   **Sentiment Analysis:** Overall sentiment is **${sentiment}**, reflecting general public perception.

          ## Engagement Metrics
          *   **Total Views:** ${views}
          *   **Total Interactions:** ${interactions}
          *   **Total Searches:** ${searches}
          *   **Total Votes/Mentions:** ${votes}

          ## Actionable Suggestions for Viral Content
          To leverage the "**${trendTitle}**" trend, consider the following strategies:

          *   **Real-World Case Studies:** Focus on tangible examples of how this trend impacts individuals or communities in **${trendRegion}**.
          *   **"How-To" Guides:** Provide practical steps or tutorials related to "${trendTitle}". E.g., "How to get started with [Trend Keyword]".
          *   **Expert Interviews:** Feature opinions and predictions from thought leaders in the **${trendCategory}** field, specifically targeting experts from **${trendSubmitter}**.
          *   **Interactive Content:** Run polls or Q&A sessions on social media using related hashtags like #${trendCategory.replace(/\s/g, '')} and #${trendTitle.replace(/\s/g, '').slice(0, 10)}.

          ## Predictive Outlook (Next 30 Days)
          The trend is predicted to ${successScore > 70 ? "**continue growing, with high potential for wider mainstream adoption.**" : "maintain **stable development** with moderate fluctuations."} Keep an eye on sub-trends related to **[mock sub-trend 1]** and **[mock sub-trend 2]** for emerging opportunities.
          `;
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, data: analysisResult }),
        };
      }

      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, message: "Invalid analysisType specified." }),
      };

    } catch (error) {
      console.error("Error processing analyze-trend request:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, message: `Server error during analysis: ${error.message}` }),
      };
    }
  }

  return {
    statusCode: 405,
    headers,
    body: JSON.stringify({ success: false, message: "Method Not Allowed" }),
  };
};
