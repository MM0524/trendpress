// Client-side Gemini API Manager (stub for local development)
// Provides the interface expected by index.html without calling external services.
// Replace with a real implementation if you want live Gemini AI on the client.

(function(){
  class GeminiAPIManager {
    constructor(apiKey){
      this.apiKey = apiKey;
    }
    async checkAPIStatus(){
      // Return false so UI shows offline unless you wire a real client API
      return false;
    }
    async analyzeTrend(trend, promptType){
      throw new Error('AI client is not configured for local dev. Use serverless analyze-trend instead.');
    }
  }
  window.GeminiAPIManager = GeminiAPIManager;
})();



