// Gemini API Manager for TrendPulse
class GeminiAPIManager {
  constructor(apiKey) {
      this.apiKey = apiKey;
      this.baseURL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
      this.maxRetries = 3;
      this.retryDelay = 1000;
  }

  // Tạo prompt cho phân tích xu hướng
  createTrendAnalysisPrompt(trend, promptType = 'general', timeframe = null) {
      const basePrompt = `You are an AI market trend analyst expert. 
      Please analyze the trend: "${trend.title}" in the "${trend.category}" category. 
      
      Description: ${trend.description}
      Tags: ${trend.tags.join(', ')}
      
      Please provide your analysis in English and include:`;

      if (promptType === 'viral') {
          return `${basePrompt}
          1. 3 actionable suggestions for creating viral content
          2. Primary target audience
          3. Best timing to leverage this trend
          4. Most suitable platforms
          
          Please use bullet points and keep it concise.`;
      } 
      else if (promptType === 'predict') {
          let periodText = "the next 1 month"; // default
          if (timeframe === '7d') periodText = "the next 7 days (1 week)";
          else if (timeframe === '1m') periodText = "the next 1 month";
          else if (timeframe === '3m') periodText = "the next 3 months";

          return `${basePrompt}
          Now, please PREDICT how this trend may evolve over ${periodText}, considering:
          1. Expected growth or decline
          2. Potential new audience segments
          3. Market or cultural events that may influence this trend
          4. Opportunities for businesses/creators
          5. Possible risks or challenges
          
          Please provide this forecast in a structured, easy-to-understand way.`;
      } 
      else {
          return `${basePrompt}
          1. Market Impact
          2. Target Audience
          3. Monetization Opportunities
          4. Future Outlook
          5. Risks to Consider
          
          Please provide detailed but easy-to-understand analysis.`;
      }
  }

  // Gọi API Gemini với retry logic
  async generateContent(prompt, retryCount = 0) {
      try {
          const response = await fetch(`${this.baseURL}?key=${this.apiKey}`, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                  contents: [{
                      parts: [{
                          text: prompt
                      }]
                  }],
                  generationConfig: {
                      temperature: 0.7,
                      topK: 40,
                      topP: 0.95,
                      maxOutputTokens: 800,
                  },
                  safetySettings: [
                      {
                          category: "HARM_CATEGORY_HARASSMENT",
                          threshold: "BLOCK_MEDIUM_AND_ABOVE"
                      },
                      {
                          category: "HARM_CATEGORY_HATE_SPEECH",
                          threshold: "BLOCK_MEDIUM_AND_ABOVE"
                      }
                  ]
              })
          });

          if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              throw new Error(`API Error: ${response.status} - ${errorData.error?.message || response.statusText}`);
          }

          const data = await response.json();
          
          if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
              throw new Error('Invalid response format from Gemini API');
          }

          return data.candidates[0].content.parts[0].text;

      } catch (error) {
          console.error(`Gemini API call failed (attempt ${retryCount + 1}):`, error);
          
          if (retryCount < this.maxRetries && this.shouldRetry(error)) {
              await this.delay(this.retryDelay * Math.pow(2, retryCount));
              return this.generateContent(prompt, retryCount + 1);
          }
          
          throw error;
      }
  }

  // Kiểm tra xem có nên retry không
  shouldRetry(error) {
      const retryableErrors = [
          'fetch',
          'network',
          'timeout',
          '500',
          '502',
          '503',
          '504'
      ];
      
      return retryableErrors.some(retryable => 
          error.message.toLowerCase().includes(retryable) ||
          error.name === 'TypeError'
      );
  }

  // Delay function
  delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Phân tích xu hướng với AI
  async analyzeTrend(trend, promptType = 'general', timeframe = null) {
      try {
          const prompt = this.createTrendAnalysisPrompt(trend, promptType, timeframe);
          const insight = await this.generateContent(prompt);
          return this.formatInsight(insight, promptType);
      } catch (error) {
          throw new Error(`Unable to analyze trend: ${error.message}`);
      }
  }

  // Hàm chuyên để dự đoán với timeframe tùy chọn
  async predictFutureTrend(trend, timeframe = '1m') {
      return this.analyzeTrend(trend, 'predict', timeframe);
  }

  // Format insight để hiển thị đẹp hơn
  formatInsight(insight, promptType) {
      // Chuyển đổi markdown-style formatting thành HTML
      let formatted = insight
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
          .replace(/^[-*]\s+/gm, '• ')
          .replace(/\n\n/g, '</p><p>')
          .replace(/\n/g, '<br>');
      
      return `<p>${formatted}</p>`;
  }

  // Kiểm tra trạng thái API
  async checkAPIStatus() {
      try {
          const response = await fetch(`${this.baseURL}?key=${this.apiKey}`, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                  contents: [{
                      parts: [{
                          text: "Hello"
                      }]
                  }]
              })
          });
          
          return response.ok;
      } catch (error) {
          return false;
      }
  }
}

// Export cho sử dụng global
window.GeminiAPIManager = GeminiAPIManager;
