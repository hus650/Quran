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

/**
 * Gelişmiş Arapça Normalizasyon ve Temizleme
 */
function normalizeArabicText(text) {
    if (!text || typeof text !== 'string') return "";
    
    return text
        // Harekeler (Tashkeel) ve Okuma İşaretleri
        .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '')
        // Ayet Numaraları, Parantezler ve Özel Simgeler
        .replace(/[﴿﴾0-9\(\)\[\]\{\}\.\,\;\:\-\_\"\']/g, '')
        // Elif, Hemze ve Ya/Afe Varyasyonları
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ؤ/g, 'ء')
        .replace(/ئ/g, 'ء')
        .replace(/ة/g, 'ه')
        // Birden fazla boşluğu teke indir
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * İki kelime arasındaki benzerliği hesaplayan Levenshtein Mesafesi
 */
function getLevenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

/**
 * Esnek Kelime Benzerlik Kontrolü
 */
function isSimilarWord(w1, w2) {
    if (w1 === w2) return true;
    if (Math.abs(w1.length - w2.length) > 2) return false;
    
    const dist = getLevenshteinDistance(w1, w2);
    const maxLen = Math.max(w1.length, w2.length);
    
    // Kelime uzunluğuna göre esneklik payı (%80 benzerlik kabul edilir)
    return (dist / maxLen) <= 0.25;
}

/**
 * Sunucu Tarafı Kelime Bazlı Analiz Motoru
 */
async function analyzeRecitation(originalText, transcribedText) {
    const cleanOrig = normalizeArabicText(originalText);
    const cleanTrans = normalizeArabicText(transcribedText);

    const origWords = cleanOrig.split(' ').filter(w => w.length > 0);
    const transWords = cleanTrans.split(' ').filter(w => w.length > 0);

    let matchedCount = 0;
    const missingOrWrong = [];
    let transPointer = 0;

    for (let i = 0; i < origWords.length; i++) {
        const currentOrig = origWords[i];
        let foundMatch = false;

        // Okunan kelimeler içinde sırayı bozmadan ara (Arama penceresi: max 5 kelime ileri)
        const searchLimit = Math.min(transPointer + 5, transWords.length);
        for (let j = transPointer; j < searchLimit; j++) {
            if (isSimilarWord(currentOrig, transWords[j])) {
                matchedCount++;
                transPointer = j + 1;
                foundMatch = true;
                break;
            }
        }

        if (!foundMatch) {
            // Sadece anlamlı uzunluktaki kelimeleri hata listesine ekle
            if (currentOrig.length > 1) {
                missingOrWrong.push(currentOrig);
            }
        }
    }

    const accuracyPercentage = origWords.length > 0 
        ? Math.min(100, Math.round((matchedCount / origWords.length) * 100)) 
        : 0;

    const uniqueErrors = [...new Set(missingOrWrong)].slice(0, 12);

    let feedbackAr = "تلاوة طيبة، واصل التلاوة والتدريب لتثبيت الحفظ.";
    
    if (process.env.GROQ_API_KEY) {
        try {
            const response = await axios.post(
                'https://api.groq.com/openai/v1/chat/completions',
                {
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { 
                            role: 'system', 
                            content: 'أنت معلم قرآن كريم. قيم التلاوة بناء على الدقة والكلمات المفقودة بأسلوب تشجيعي موجز جداً (جملة واحدة فقط). أرجع النتيجة بصيغة JSON حصراً: {"feedback_ar": "نص التقييم"}' 
                        },
                        { 
                            role: 'user', 
                            content: `نسبة الدقة: %${accuracyPercentage}. الكلمات غير المتقنة: ${uniqueErrors.join(', ')}` 
                        }
                    ],
                    response_format: { type: 'json_object' },
                    temperature: 0.1
                },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 7000
                }
            );
            
            const jsonRes = JSON.parse(response.data.choices[0].message.content);
            if (jsonRes.feedback_ar) feedbackAr = jsonRes.feedback_ar;
        } catch (err) {
            console.error("LLM Feedback Hatası:", err.message);
        }
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
    console.log(`✅ Sunucu Port ${PORT} Üzerinde Aktif!`);
});
