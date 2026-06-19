// backend/list-models.js
require('dotenv').config();

async function checkModels() {
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GOOGLE_API_KEY}`);
        const data = await response.json();
        
        if (data.error) {
            console.error("❌ API Error:", data.error.message);
            return;
        }

        console.log("✅ AVAILABLE MODELS FOR YOUR KEY:");
        // Filter out old models and only show Gemini ones
        const geminiModels = data.models
            .filter(m => m.name.includes('gemini'))
            .map(m => m.name.replace('models/', ''));
            
        console.log(geminiModels);
    } catch (error) {
        console.error("Fetch Error:", error.message);
    }
}

checkModels();