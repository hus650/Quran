require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

function normalizeArabicText(text) {
    if (!text || typeof text !== 'string') return "";
    
    return text
        .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '')
        .replace(/[﴿﴾0-9\(\)\[\]\{\}\.\,\;\:\-\_\"\']/g, '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ؤ/g, 'ء')
        .replace(/ئ/g, 'ء')
        .replace(/ة/g, 'ه')
        .replace(/\s+/g, ' ')
        .trim();
}

function isSimilarWord(w1, w2) {
    if (!w1 || !w2) return false;
    if (w1 === w2) return true;
    if (Math.abs(w1.length - w2.length) > 2) return false;

    let matches = 0;
    const minLen = Math.min(w1.length, w2.length);
    for (let i = 0; i < minLen; i++) {
        if (w1[i] === w2[i]) matches++;
    }
    
    return (matches / Math.max(w1.length, w2.length)) >= 0.70;
}

async function analyzeRecitation(originalText, transcribedText) {
    const cleanOrig = normalizeArabicText(originalText);
    const cleanTrans = normalizeArabicText(transcribedText);

    const origWords = cleanOrig.split(' ').filter(w => w.length > 0);
    const rawTransWords = cleanTrans.split(' ').filter(w => w.length > 0);

    if (origWords.length === 0) {
        return { accuracy_percentage: 0, missing_or_wrong_words: [], feedback_ar: "لم يتم اكتشاف قراءة." };
    }

    let matchedUniqueCount = 0;
    const missingOrWrong = [];

    origWords.forEach(origWord => {
        const isRead = rawTransWords.some(transWord => isSimilarWord(origWord, transWord));
        if (isRead) {
            matchedUniqueCount++;
        } else {
            if (origWord.length > 1) {
                missingOrWrong.push(origWord);
            }
        }
    });

    let accuracyPercentage = Math.round((matchedUniqueCount / origWords.length) * 100);
    accuracyPercentage = Math.min(100, Math.max(0, accuracyPercentage));

    const uniqueErrors = [...new Set(missingOrWrong)].slice(0, 10);

    let feedbackAr = accuracyPercentage >= 80 
        ? "تلاوة مباركة وممتازة! ما شاء الله." 
        : "تلاوة طيبة، يرجى التكرار والممارسة لتثبيت الكلمات المتبقية.";

    if (process.env.GROQ_API_KEY) {
        try {
            const response = await axios.post(
                'https://api.groq.com/openai/v1/chat/completions',
                {
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { 
                            role: 'system', 
                            content: 'أنت معلم قرآن كريم. أكتب جملة تشجيعية قصيرة جداً باللغة العربية. أرجع JSON حصراً: {"feedback_ar": "نص التقييم"}' 
                        },
                        { 
                            role: 'user', 
                            content: `نسبة الإتقان: %${accuracyPercentage}` 
                        }
                    ],
                    response_format: { type: 'json_object' },
                    temperature: 0.2
                },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 5000
                }
            );
            
            const jsonRes = JSON.parse(response.data.choices[0].message.content);
            if (jsonRes.feedback_ar) feedbackAr = jsonRes.feedback_ar;
        } catch (err) {}
    }

    return {
        accuracy_percentage: accuracyPercentage,
        missing_or_wrong_words: uniqueErrors,
        feedback_ar: feedbackAr
    };
}

app.post('/api/analyze-text', async (req, res) => {
    try {
        const { originalText, transcribedText } = req.body;
        if (!originalText) {
            return res.status(400).json({ success: false, message: 'النص الأصلي مطلوب.' });
        }

        const data = await analyzeRecitation(originalText, transcribedText || "");
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`✅ Stabil Server Port ${PORT} Üzerinde Aktif!`);
});
