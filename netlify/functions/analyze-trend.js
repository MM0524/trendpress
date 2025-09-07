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

      const trendTitle = (language === 'vi' ? trend.title_vi : trend.title_en) || trend.title_en || trend.title_vi || (language === 'vi' ? "Không có tiêu đề" : "No Title Provided");
      const trendDescription = (language === 'vi' ? trend.description_vi : trend.description_en) || trend.description_en || trend.description_vi || (language === 'vi' ? "Không có mô tả" : "No description provided.");
      const trendCategory = trend.category || (language === 'vi' ? "Chung" : "General");
      const trendRegion = trend.region === 'vn' ? (language === 'vi' ? 'Việt Nam' : 'Vietnam') : (trend.region === 'us' ? (language === 'vi' ? 'Hoa Kỳ' : 'United States') : (language === 'vi' ? 'Toàn cầu' : 'Global')); // Translate region for analysis
      const trendSubmitter = trend.submitter || (language === 'vi' ? 'Nguồn không xác định' : 'Unknown Source');
      const trendDate = trend.date ? new Date(trend.date).toLocaleDateString(language === 'vi' ? 'vi-VN' : 'en-US') : (language === 'vi' ? 'Ngày không xác định' : 'Unknown Date');
      
      const views = trend.views || 0;
      const interactions = trend.interactions || 0;
      const searches = trend.searches || 0;
      const votes = trend.votes || 0;

      if (trendTitle === (language === 'vi' ? "Không có tiêu đề" : "No Title Provided") || trendDescription === (language === 'vi' ? "Không có mô tả" : "No description provided.")) {
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
          successScore: parseFloat(successScore.toFixed(0)), 
          summary: htmlSummary, 
        };
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, data: analysisResult }), 
        };

      } else if (analysisType === 'detailed') {
        const successScore = trend.hotnessScore ? (Math.min(99, Math.max(20, trend.hotnessScore * 100 + Math.random() * 10 - 5))) : (Math.floor(Math.random() * 40) + 60);
        const sentiment = successScore > 75 ? (language === 'vi' ? "tích cực" : "positive") : (successScore > 50 ? (language === 'vi' ? "trung lập" : "neutral") : (language === 'vi' ? "hỗn hợp" : "mixed"));
        const audienceDemographics = trend.category === "Gaming" ? (language === 'vi' ? "đối tượng trẻ (18-30)" : "younger audience (18-30)") : (trend.category === "Fashion" ? (language === 'vi' ? "những người quan tâm thời trang (20-40)" : "fashion-conscious individuals (20-40)") : (language === 'vi' ? "người dùng đa dạng quan tâm đổi mới" : "diverse users interested in innovation"));

        const detailedAnalysisContent = language === 'vi' ? `
          <div class="ai-section">
              <h4><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 8px;"><path d="M20 17.58A5 5 0 0 0 18 10c0-1.84-.82-2.91-1.2-3.46C15.65 5.56 14 5 12 5a7 7 0 0 0-4 1.55c-1.37 1.25-2.26 2.92-2.76 4.67-1.4 5.38-2.67 9.17-2.75 9.42-.03.07-.05.15-.05.21V22h19v-1.75c0-.07-.02-.15-.05-.21z"></path></svg>Phân tích chuyên sâu cho "${trendTitle}"</h4>
              <p>Xu hướng "<strong class="ai-highlight">${trendTitle}</strong>", được phân loại là <strong class="ai-highlight">${trendCategory}</strong> và mô tả là "${trendDescription}", mang lại nhiều cơ hội để hiểu sâu hơn. Phân tích AI này cung cấp cái nhìn tổng quan toàn diện, tận dụng dữ liệu có sẵn và các mô hình dự đoán.</p>
          </div>

          <div class="ai-section">
              <h4><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 8px;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>Những phát hiện chính</h4>
              <ul>
                  <li><strong>Điểm liên quan:</strong> <strong class="ai-highlight">${successScore}%</strong> (Mức độ liên quan tổng thể đến động lực thị trường hiện tại).</li>
                  <li><strong>Mô hình xuất hiện:</strong> Xu hướng ${successScore > 70 ? "cho thấy sự tăng trưởng nhanh chóng, đạt đỉnh trong vài ngày qua" : "đang cho thấy sự quan tâm ổn định kể từ khi ra đời vào ngày " + trendDate}.</li>
                  <li><strong>Nhân khẩu học đối tượng:</strong> Chủ yếu gây được tiếng vang với ${audienceDemographics} quan tâm đến lĩnh vực ${trendCategory.toLowerCase()} và sự đổi mới.</li>
                  <li><strong>Điểm nóng địa lý:</strong> Mức độ tương tác mạnh nhất được quan sát thấy ở <strong class="ai-highlight">${trendRegion}</strong>, cho thấy sự tập trung thị trường cụ thể.</li>
                  <li><strong>Phân tích tâm lý:</strong> Tâm lý chung là <strong class="ai-highlight">${sentiment}</strong>, phản ánh nhận thức chung của công chúng.</li>
              </ul>
          </div>

          <div class="ai-section">
              <h4><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 8px;"><path d="M22 17H2c-.55 0-1 .45-1 1s.45 1 1 1h20c.55 0 1-.45 1-1s-.45-1-1-1zM22 11H2c-.55 0-1 .45-1 1s.45 1 1 1h20c.55 0 1-.45 1-1s-.45-1-1-1zM22 5H2c-.55 0-1 .45-1 1s.45 1 1 1h20c.55 0 1-.45 1-1s-.45-1-1-1z"></path></svg>Các chỉ số tương tác</h4>
              <div class="ai-metric-grid">
                  <div class="ai-metric-item"><strong>${views}</strong><span>Lượt xem</span></div>
                  <div class="ai-metric-item"><strong>${interactions}</strong><span>Tương tác</span></div>
                  <div class="ai-metric-item"><strong>${searches}</strong><span>Tìm kiếm</span></div>
                  <div class="ai-metric-item"><strong>${votes}</strong><span>Bầu chọn</span></div>
              </div>
          </div>

          <div class="ai-section">
              <h4><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 8px;"><path d="M12 19l-7-7 7-7 7 7-7 7z"></path></svg>Đề xuất hành động cho nội dung viral</h4>
              <p>Để tận dụng xu hướng "<strong class="ai-highlight">${trendTitle}</strong>", hãy xem xét các chiến lược sau:</p>
              <ul>
                  <li><strong>Nghiên cứu điển hình thực tế:</strong> Tập trung vào các ví dụ cụ thể về cách xu hướng này tác động đến các cá nhân hoặc cộng đồng ở <strong class="ai-highlight">${trendRegion}</strong>.</li>
                  <li><strong>Hướng dẫn "Cách làm":</strong> Cung cấp các bước thực tế hoặc hướng dẫn liên quan đến "<strong class="ai-highlight">${trendTitle}</strong>". Ví dụ: "Cách bắt đầu với [Từ khóa xu hướng]".</li>
                  <li><strong>Phỏng vấn chuyên gia:</strong> Đưa ra ý kiến và dự đoán từ các nhà lãnh đạo tư tưởng trong lĩnh vực <strong class="ai-highlight">${trendCategory}</strong>, đặc biệt nhắm mục tiêu đến các chuyên gia từ <strong class="ai-highlight">${trendSubmitter}</strong>.</li>
                  <li><strong>Nội dung tương tác:</strong> Chạy các cuộc thăm dò hoặc phiên hỏi đáp trên mạng xã hội bằng cách sử dụng các hashtag liên quan như <strong class="ai-highlight">#${trendCategory.replace(/\s/g, '')}</strong> và <strong class="ai-highlight">#${trendTitle.replace(/\s/g, '').slice(0, 10)}</strong>.</li>
              </ul>
          </div>

          <div class="ai-section">
              <h4><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 8px;"><path d="M16 17l5-5-5-5M12 2v20M8 7l-5 5 5 5"></path></svg>Triển vọng dự đoán (30 ngày tới)</h4>
              <p>Xu hướng được dự đoán sẽ ${successScore > 70 ? "<strong class='ai-highlight'>tiếp tục phát triển, với tiềm năng cao để được chấp nhận rộng rãi hơn.</strong>" : "<strong class='ai-highlight'>duy trì sự phát triển ổn định</strong> với những biến động vừa phải."} Hãy theo dõi các xu hướng phụ liên quan đến <strong class="ai-highlight">[xu hướng phụ giả định 1]</strong> và <strong class="ai-highlight">[xu hướng phụ giả định 2]</strong> để tìm kiếm các cơ hội mới nổi.</p>
          </div>
        ` : `
          <div class="ai-section">
              <h4><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 8px;"><path d="M20 17.58A5 5 0 0 0 18 10c0-1.84-.82-2.91-1.2-3.46C15.65 5.56 14 5 12 5a7 7 0 0 0-4 1.55c-1.37 1.25-2.26 2.92-2.76 4.67-1.4 5.38-2.67 9.17-2.75 9.42-.03.07-.05.15-.05.21V22h19v-1.75c0-.07-.02-.15-.05-.21z"></path></svg>AI Deep Dive for "${trendTitle}"</h4>
              <p>The trend "<strong class="ai-highlight">${trendTitle}</strong>", categorized as <strong class="ai-highlight">${trendCategory}</strong> and described as "${trendDescription}", presents opportunities for deeper insights. This AI analysis provides a comprehensive overview, leveraging available data and predictive models.</p>
          </div>

          <div class="ai-section">
              <h4><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 8px;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>Key Findings</h4>
              <ul>
                  <li><strong>Relevance Score:</strong> <strong class="ai-highlight">${successScore}%</strong> (Overall relevance to current market dynamics).</li>
                  <li><strong>Emergence Pattern:</strong> The trend ${successScore > 70 ? "shows a rapid ascent, peaking within the last few days" : "is showing steady interest since its inception on " + trendDate}.</li>
                  <li><strong>Audience Demographics:</strong> Primarily resonates with ${audienceDemographics} interested in ${trendCategory.toLowerCase()} and innovation.</li>
                  <li><strong>Geographical Hotspots:</strong> Strongest engagement observed in <strong class="ai-highlight">${trendRegion}</strong>, indicating specific market concentration.</li>
                  <li><strong>Sentiment Analysis:</strong> Overall sentiment is <strong class="ai-highlight">${sentiment}</strong>, reflecting general public perception.</li>
              </ul>
          </div>

          <div class="ai-section">
              <h4><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 8px;"><path d="M22 17H2c-.55 0-1 .45-1 1s.45 1 1 1h20c.55 0 1-.45 1-1s-.45-1-1-1zM22 11H2c-.55 0-1 .45-1 1s.45 1 1 1h20c.55 0 1-.45 1-1s-.45-1-1-1zM22 5H2c-.55 0-1 .45-1 1s.45 1 1 1h20c.55 0 1-.45 1-1s-.45-1-1-1z"></path></svg>Engagement Metrics</h4>
              <div class="ai-metric-grid">
                  <div class="ai-metric-item"><strong>${views}</strong><span>Views</span></div>
                  <div class="ai-metric-item"><strong>${interactions}</strong><span>Interactions</span></div>
                  <div class="ai-metric-item"><strong>${searches}</strong><span>Searches</span></div>
                  <div class="ai-metric-item"><strong>${votes}</strong><span>Votes</span></div>
              </div>
          </div>

          <div class="ai-section">
              <h4><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 8px;"><path d="M12 19l-7-7 7-7 7 7-7 7z"></path></svg>Actionable Suggestions for Viral Content</h4>
              <p>To leverage the "<strong class="ai-highlight">${trendTitle}</strong>" trend, consider the following strategies:</p>
              <ul>
                  <li><strong>Real-World Case Studies:</strong> Focus on tangible examples of how this trend impacts individuals or communities in <strong class="ai-highlight">${trendRegion}</strong>.</li>
                  <li><strong>"How-To" Guides:</strong> Provide practical steps or tutorials related to "<strong class="ai-highlight">${trendTitle}</strong>". E.g., "How to get started with [Trend Keyword]".</li>
                  <li><strong>Expert Interviews:</strong> Feature opinions and predictions from thought leaders in the <strong class="ai-highlight">${trendCategory}</strong> field, specifically targeting experts from <strong class="ai-highlight">${trendSubmitter}</strong>.</li>
                  <li><strong>Interactive Content:</strong> Run polls or Q&A sessions on social media using related hashtags like <strong class="ai-highlight">#${trendCategory.replace(/\s/g, '')}</strong> and <strong class="ai-highlight">#${trendTitle.replace(/\s/g, '').slice(0, 10)}</strong>.</li>
              </ul>
          </div>

          <div class="ai-section">
              <h4><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 8px;"><path d="M16 17l5-5-5-5M12 2v20M8 7l-5 5 5 5"></path></svg>Predictive Outlook (Next 30 Days)</h4>
              <p>The trend is predicted to ${successScore > 70 ? "<strong class='ai-highlight'>continue growing, with high potential for wider mainstream adoption.</strong>" : "<strong class='ai-highlight'>maintain stable development</strong> with moderate fluctuations."} Keep an eye on sub-trends related to <strong class="ai-highlight">[mock sub-trend 1]</strong> and <strong class="ai-highlight">[mock sub-trend 2]</strong> for emerging opportunities.</p>
          </div>
        `;

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, data: detailedAnalysisContent }), 
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
