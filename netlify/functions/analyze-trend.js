// File: netlify/functions/analyze-trend.js
const fetch = require('node-fetch');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

// CẬP NHẬT: Thêm tham số `language`
const createStructuredSummaryPrompt = (trend, language) => {
    const langInstruction = language === 'vi' ? 'Respond in VIETNAMESE.' : 'Respond in ENGLISH.';
    return `Analyze the trend: "${trend.title}". ${langInstruction} Respond ONLY with a valid JSON object with this structure: {"successScore": <a number between 0-100 for the trend's potential>,"summary": "<a one-paragraph summary of the trend's potential>","historicalData": [<array of 4 numbers for interest over the last 4 months>],"futureProjection": [<array of 1 number for a forecast for the next 7 days>]}`;
};

// CẬP NHẬT: Thêm tham số `language`
const createDetailedAnalysisPrompt = (trend, language) => {
    const langInstruction = language === 'vi' ? 'Provide a detailed professional analysis in VIETNAMESE.' : 'Provide a detailed professional analysis in ENGLISH.';
    return `Analyze the trend: "${trend.title}" (Category: ${trend.category}). Description: "${trend.description}". ${langInstruction} Structure your response using markdown with these EXACT sections:\n### Analysis of "${trend.title}" Trend\n<A paragraph explaining the core concept.>\n### Actionable Suggestions for Viral Content\n* **Real-World Case Studies:** <suggestion>\n* **"Horror Stories" & Solutions:** <suggestion>\n### Primary Target Audience\n* <Audience 1>\n* <Audience 2>\n### Most Suitable Platforms\n* **Platform 1 (e.g., YouTube):** <reason>\n* **Platform 2 (e.g., LinkedIn):** <reason>`;
};


exports.handler = async (event) => {
  if (event.httpMethod === 'GET') { return { statusCode: 200, body: JSON.stringify({ status: 'ok' }) }; }
  if (event.httpMethod !== 'POST') { return { statusCode: 405, body: 'Method Not Allowed' }; }

  try {
    if (!event.body) { return { statusCode: 400, body: 'Bad Request: Missing request body.' }; }
    
    // CẬP NHẬT: Nhận thêm `language` từ client
    const { trend, analysisType, language } = JSON.parse(event.body);

    if (!trend) { return { statusCode: 400, body: 'Bad Request: Missing trend data.' }; }

    const isSummary = analysisType === 'summary';
    const prompt = isSummary ? createStructuredSummaryPrompt(trend, language) : createDetailedAnalysisPrompt(trend, language);
    
    const generationConfig = { temperature: 0.7, maxOutputTokens: 2048 };
    if (isSummary) { generationConfig.responseMimeType = "application/json"; }

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
      headers: { 'Content-Type': 'application/json', "Access-Control-Allow-Origin": "*" },
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
