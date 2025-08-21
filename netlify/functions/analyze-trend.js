// File: netlify/functions/analyze-trend.js

// Import 'node-fetch' để gọi API từ server
const fetch = require('node-fetch');

// Lấy API key đã được giấu an toàn trong biến môi trường của Netlify
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

// Prompt để lấy JSON tóm tắt
const createStructuredSummaryPrompt = (trend) => `Analyze the trend: "${trend.title}". Respond ONLY with a valid JSON object with this structure: {"successScore": <a number between 0-100 for the trend's potential>,"summary": "<a one-paragraph summary of the trend's potential>","historicalData": [<array of 4 numbers for interest over the last 4 months>],"futureProjection": [<array of 1 number for a forecast for the next 7 days>]}`;

// Prompt để lấy phân tích chi tiết
const createDetailedAnalysisPrompt = (trend) => `Analyze the trend: "${trend.title}" (Category: ${trend.category}). Description: "${trend.description}". Provide a detailed professional analysis in English. Structure your response using markdown with these EXACT sections:\n### Analysis of "${trend.title}" Trend\n<A paragraph explaining the core concept.>\n### Actionable Suggestions for Viral Content\n* **Real-World Case Studies:** <suggestion>\n* **"Horror Stories" & Solutions:** <suggestion>\n### Primary Target Audience\n* <Audience 1>\n* <Audience 2>\n### Most Suitable Platforms\n* **Platform 1 (e.g., YouTube):** <reason>\n* **Platform 2 (e.g., LinkedIn):** <reason>`;


exports.handler = async (event) => {
  // Chỉ cho phép phương thức POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { trend, analysisType } = JSON.parse(event.body);
    if (!trend) {
        return { statusCode: 400, body: 'Bad Request: Missing trend data.' };
    }

    const isSummary = analysisType === 'summary';
    const prompt = isSummary ? createStructuredSummaryPrompt(trend) : createDetailedAnalysisPrompt(trend);
    
    const generationConfig = {
        temperature: 0.7,
        maxOutputTokens: 2048,
    };
    if (isSummary) {
        generationConfig.responseMimeType = "application/json";
    }

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig })
    });

    if (!response.ok) {
        const errorBody = await response.text();
        console.error('Gemini API Error:', errorBody);
        return { statusCode: response.status, body: `Gemini API Error: ${errorBody}` };
    }

    const data = await response.json();
    const textContent = data.candidates[0].content.parts[0].text;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, data: textContent }),
    };
  } catch (error) {
    console.error('Serverless function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: 'Internal Server Error' }),
    };
  }
};
