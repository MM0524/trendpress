// File: netlify/functions/analyze-trend.js
const fetch = require("node-fetch");

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Language", // Ensure X-Language is allowed
  };

  // Handle preflight OPTIONS request
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  // --- AI Status Check (GET request) ---
  if (event.httpMethod === "GET") {
    // This is for the AI status indicator. Just return a success.
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

      // **Critical:** Ensure we get a valid title and description from the trend object.
      // Use localized title/description if available, fallback to English, then generic.
      const trendTitle = (language === 'vi' ? trend.title_vi : trend.title_en) || trend.title_en || trend.title_vi || "No Title Provided";
      const trendDescription = (language === 'vi' ? trend.description_vi : trend.description_en) || trend.description_en || trend.description_vi || "No description provided.";
      const trendCategory = trend.category || "General";

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
        // --- Mock Summary Analysis ---
        // In a real app, this would call an actual AI/ML model
        const successScore = trend.hotnessScore ? (Math.min(95, Math.max(50, trend.hotnessScore * 100))) : (Math.floor(Math.random() * 40) + 60);
        analysisResult = {
          successScore: parseFloat(successScore.toFixed(0)),
          summary: `This is a summary for the trend "${trendTitle}" in category "${trendCategory}". It appears to be highly relevant with a score of ${successScore}%. The core focus revolves around **${trendTitle}**. This trend indicates significant user interest and potential for growth within the **${trendCategory}** domain, particularly in areas like [mock engagement metrics].`,
        };
        // Return summary as JSON string, as frontend expects to parse it
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, data: JSON.stringify(analysisResult) }),
        };

      } else if (analysisType === 'detailed') {
        // --- Mock Detailed Analysis ---
        // In a real app, this would call a more extensive AI/ML model
        analysisResult = `
          # AI Deep Dive for "${trendTitle}"

          ## Analysis of "${trendTitle}" Trend
          The trend "${trendTitle}", categorized as **${trendCategory}** and described as "${trendDescription}", presents opportunities for deeper insights.
          This AI analysis provides a comprehensive overview, leveraging available data and predictive models.

          **Key Findings:**
          *   **Emergence Pattern:** The trend shows a rapid ascent, peaking within the last 7 days.
          *   **Audience Demographics:** Primarily resonates with users aged 25-45 interested in technology and innovation.
          *   **Geographical Hotspots:** Strongest engagement observed in ${trend.region === 'vn' ? 'Vietnam' : (trend.region === 'us' ? 'United States' : 'Global metropolitan areas')}.
          *   **Sentiment Analysis:** Overall sentiment is positive (78%), driven by excitement for new developments.

          ## Actionable Suggestions for Viral Content
          To leverage the **${trendTitle}** trend, consider the following strategies:

          *   **Real-World Case Studies:** Focus on tangible examples of how this trend impacts individuals or communities. For instance, if the topic relates to economic policy, showcase specific businesses or families affected by the policy.
          *   **"How-To" Guides:** Provide practical steps or tutorials related to the trend. E.g., "How to get started with [Trend Keyword]".
          *   **Expert Interviews:** Feature opinions and predictions from thought leaders in the **${trendCategory}** field.
          *   **Interactive Content:** Quizzes, polls, or Q&A sessions to boost engagement around the topic.

          ## Predictive Outlook (Next 30 Days)
          The trend is predicted to continue growing, with potential for wider mainstream adoption. Keep an eye on sub-trends related to [mock sub-trend 1] and [mock sub-trend 2].
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

  // Handle unsupported HTTP methods
  return {
    statusCode: 405,
    headers,
    body: JSON.stringify({ success: false, message: "Method Not Allowed" }),
  };
};
