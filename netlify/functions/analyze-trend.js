// netlify/functions/analyze-trend.js
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
      const trendRegion = trend.region === 'vn' ? (language === 'vi' ? 'Việt Nam' : 'Vietnam') : (trend.region === 'us' ? (language === 'vi' ? 'Hoa Kỳ' : 'United States') : (language === 'vi' ? 'Toàn cầu' : 'Global')); // Translate region for analysis
      const trendSubmitter = trend.submitter || (language === 'vi' ? 'Nguồn không xác định' : 'Unknown Source');
      const trendDate = trend.date ? new Date(trend.date).toLocaleDateString(language === 'vi' ? 'vi-VN' : 'en-US') : (language === 'vi' ? 'Ngày không xác định' : 'Unknown Date');
      
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
            data: (language === 'vi' ? "Xu hướng không có tiêu đề hoặc mô tả hợp lệ. Vui lòng đảm bảo dữ liệu xu hướng đầy đủ trước khi yêu cầu phân tích." : "The provided trend has no valid title or description. Please ensure the trend data is complete before requesting analysis.")
          }),
        };
      }
      
      let analysisResult = {};

      if (analysisType === 'summary') {
        const successScore = trend.hotnessScore ? 
                             (Math.min(99, Math.max(20, trend.hotnessScore * 100 + Math.random() * 10 - 5))) :
                             (Math.floor(Math.random() * 40) + 60);
        
        const sentiment = successScore > 75 ? (language === 'vi' ? "tích cực" : "positive") : (successScore > 50 ? (language === 'vi' ? "trung lập" : "neutral") : (language === 'vi' ? "hỗn hợp" : "mixed"));
        const growthPotential = successScore > 80 ? (language === 'vi' ? "tiềm năng tăng trưởng cao" : "high potential for growth") : (successScore > 60 ? (language === 'vi' ? "tăng trưởng vừa phải" : "moderate growth") : (language === 'vi' ? "phát triển ổn định" : "stable development"));
        
        // CẬP NHẬT: Tạo summary bằng HTML trực tiếp, không stringify bên trong
        const htmlSummary = language === 'vi' ? `
            <ul style="list-style-type: disc; padding-left: 20px; text-align: left;">
                <li><strong>Xu hướng:</strong> "${trendTitle}" (Lĩnh vực: ${trendCategory}).</li>
                <li><strong>Nguồn gốc:</strong> Từ ${trendSubmitter} vào ngày ${trendDate}.</li>
                <li><strong>Điểm liên quan:</strong> <strong>${successScore.toFixed(0)}%</strong> (tâm lý ${sentiment}).</li>
                <li><strong>Chỉ số tương tác:</strong> Khoảng ${Math.round(views / 1000)}K lượt xem, ${Math.round(interactions / 1000)}K tương tác, ${Math.round(searches / 1000)}K lượt tìm kiếm và ${votes} lượt bầu chọn.</li>
                <li><strong>Triển vọng tăng trưởng:</strong> Xu hướng này cho thấy ${growthPotential}.</li>
                <li><strong>Trọng tâm chính:</strong> Chủ yếu xoay quanh <strong>${trendTitle}</strong>.</li>
                <li><strong>Tác động địa lý:</strong> Đặc biệt quan trọng trong bối cảnh **${trendRegion}**.</li>
            </ul>
        ` : `
            <ul style="list-style-type: disc; padding-left: 20px; text-align: left;">
                <li><strong>Trend:</strong> "${trendTitle}" (Domain: ${trendCategory}).</li>
                <li><strong>Origin:</strong> From ${trendSubmitter} on ${trendDate}.</li>
                <li><strong>Relevance Score:</strong> <strong>${successScore.toFixed(0)}%</strong> (${sentiment} sentiment).</li>
                <li><strong>Engagement Metrics:</strong> Approx. ${Math.round(views / 1000)}K views, ${Math.round(interactions / 1000)}K interactions, ${Math.round(searches / 1000)}K searches, and ${votes} votes.</li>
                <li><strong>Growth Outlook:</strong> This trend shows ${growthPotential}.</li>
                <li><strong>Key Focus:</strong> Primarily revolves around <strong>${trendTitle}</strong>.</li>
                <li><strong>Geographical Impact:</strong> Especially significant in the **${trendRegion}** context.</li>
            </ul>
        `;

        analysisResult = {
          successScore: parseFloat(successScore.toFixed(0)), // Giữ nguyên là số để client có thể dùng cho biểu đồ
          summary: htmlSummary, // Gửi về HTML đã định dạng
        };
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, data: analysisResult }), // TRẢ VỀ OBJECT JSON TRỰC TIẾP
        };

      } else if (analysisType === 'detailed') {
        const successScore = trend.hotnessScore ? (Math.min(99, Math.max(20, trend.hotnessScore * 100 + Math.random() * 10 - 5))) : (Math.floor(Math.random() * 40) + 60);
        const sentiment = successScore > 75 ? (language === 'vi' ? "tích cực" : "positive") : (successScore > 50 ? (language === 'vi' ? "trung lập" : "neutral") : (language === 'vi' ? "hỗn hợp" : "mixed"));
        const audienceDemographics = trend.category === "Gaming" ? (language === 'vi' ? "đối tượng trẻ (18-30)" : "younger audience (18-30)") : (trend.category === "Fashion" ? (language === 'vi' ? "những người quan tâm thời trang (20-40)" : "fashion-conscious individuals (20-40)") : (language === 'vi' ? "người dùng đa dạng quan tâm đổi mới" : "diverse users interested in innovation"));

        const detailedAnalysisContent = language === 'vi' ? `
          # Phân tích chuyên sâu AI cho "${trendTitle}"

          ## Phân tích xu hướng "${trendTitle}"
          Xu hướng "**${trendTitle}**", được phân loại là **${trendCategory}** và mô tả là "${trendDescription}", mang lại nhiều cơ hội để hiểu sâu hơn.
          Phân tích AI này cung cấp cái nhìn tổng quan toàn diện, tận dụng dữ liệu có sẵn và các mô hình dự đoán.

          **Những phát hiện chính:**
          *   **Điểm liên quan:** **${successScore}%** (Mức độ liên quan tổng thể đến động lực thị trường hiện tại).
          *   **Mô hình xuất hiện:** Xu hướng ${successScore > 70 ? "cho thấy sự tăng trưởng nhanh chóng, đạt đỉnh trong vài ngày qua" : "đang cho thấy sự quan tâm ổn định kể từ khi ra đời vào ngày " + trendDate}.
          *   **Nhân khẩu học đối tượng:** Chủ yếu gây được tiếng vang với ${audienceDemographics} quan tâm đến lĩnh vực ${trendCategory.toLowerCase()} và sự đổi mới.
          *   **Điểm nóng địa lý:** Mức độ tương tác mạnh nhất được quan sát thấy ở **${trendRegion}**, cho thấy sự tập trung thị trường cụ thể.
          *   **Phân tích tâm lý:** Tâm lý chung là **${sentiment}**, phản ánh nhận thức chung của công chúng.

          ## Các chỉ số tương tác
          *   **Tổng số lượt xem:** ${views}
          *   **Tổng số tương tác:** ${interactions}
          *   **Tổng số lượt tìm kiếm:** ${searches}
          *   **Tổng số lượt bầu chọn/đề cập:** ${votes}

          ## Đề xuất hành động cho nội dung viral
          Để tận dụng xu hướng "**${trendTitle}**", hãy xem xét các chiến lược sau:

          *   **Nghiên cứu điển hình thực tế:** Tập trung vào các ví dụ cụ thể về cách xu hướng này tác động đến các cá nhân hoặc cộng đồng ở **${trendRegion}**.
          *   **Hướng dẫn "Cách làm":** Cung cấp các bước thực tế hoặc hướng dẫn liên quan đến "${trendTitle}". Ví dụ: "Cách bắt đầu với [Từ khóa xu hướng]".
          *   **Phỏng vấn chuyên gia:** Đưa ra ý kiến và dự đoán từ các nhà lãnh đạo tư tưởng trong lĩnh vực **${trendCategory}**, đặc biệt nhắm mục tiêu đến các chuyên gia từ **${trendSubmitter}**.
          *   **Nội dung tương tác:** Chạy các cuộc thăm dò hoặc phiên hỏi đáp trên mạng xã hội bằng cách sử dụng các hashtag liên quan như #${trendCategory.replace(/\s/g, '')} và #${trendTitle.replace(/\s/g, '').slice(0, 10)}.

          ## Triển vọng dự đoán (30 ngày tới)
          Xu hướng được dự đoán sẽ ${successScore > 70 ? "**tiếp tục phát triển, với tiềm năng cao để được chấp nhận rộng rãi hơn.**" : "**duy trì sự phát triển ổn định** với những biến động vừa phải."} Hãy theo dõi các xu hướng phụ liên quan đến **[xu hướng phụ giả định 1]** và **[xu hướng phụ giả định 2]** để tìm kiếm các cơ hội mới nổi.
        ` : `
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
          body: JSON.stringify({ success: true, data: detailedAnalysisContent }), // Gửi về Markdown đã được localize
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
