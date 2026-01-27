import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("Please provide GEMINI_API_KEY environment variable");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

async function test() {
  try {
    console.log("Testing with gemini-2.5-flash...");
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ parts: [{ text: 'Hello, reply with JSON: {"greeting": "hello"}' }] }],
      config: {
        responseMimeType: "application/json",
      }
    });

    console.log("Response object keys:", Object.keys(response));
    console.log("Response text type:", typeof response.text);
    console.log("Response text value:", response.text);
    
    if (typeof response.text === 'function') {
        console.log("Calling response.text():", response.text());
    }

  } catch (error) {
    console.error("Error:", error);
    if (error.cause) console.error("Cause:", error.cause);
  }
}

test();
