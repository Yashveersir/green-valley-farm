require('dotenv').config();
const fetch = require('node-fetch'); // Oh wait, Node 18+ has native fetch. The user's node must have it if server.js uses it.
// Let's just mock what server.js does.
async function test() {
  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  console.log("Keys:", { geminiKey: !!geminiKey, groqKey: !!groqKey });
  
  if (geminiKey) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }]
      })
    });
    console.log("Gemini status:", res.status);
    if (!res.ok) console.log("Gemini Error:", await res.text());
  }
}
test();
