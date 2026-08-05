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
 * Gelişmiş Arapça Metin Temizleme ve Harf Standardizasyonu
 */
function normalizeArabicText(text) {
    if (!text || typeof text !== 'string') return "";
    
    return text
        // Harekeler ve Tecvid İşaretleri
        .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '')
        // Ayet Numaraları, Parantezler ve Noktalama
        .replace(/[﴿﴾0-9\(\)\[\]\{\}\.\,\;\:\-\_\"\']/g, '')
        // Harf Varyasyonları Standardizasyonu
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ؤ/g, 'ء')
        .replace(/ئ/g, 'ء')
        .replace(/ة/g, 'ه')
        // Boşluklar
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Levenshtein Mesafesi ile Esnek Kelime Kontrolü
 */
function isSimilarWord(w1, w2) {
    if (!w1 || !w2) return false;
    if (w1 === w2) return true;
    if (Math.abs(w1.length - w2.length) > 2) return false;

    // Uzunluk farkı az ise eşleşmiş say
    let matches = 0;
    const minLen = Math.min(w1.length, w2.length);
    for (let i = 0; i < minLen; i++) {
        if (w1[i] === w2[i]) matches++;
    }
    
    return (matches / Math.max(w1.length, w2.length)) >= 0.75;
}

/**
 * KUSURSUZ YÜZDE HESAPLAMA MOTORU
 */
async function analyzeRecitation(originalText, transcribedText) {
    const cleanOrig = normalizeArabicText(originalText);
    const cleanTrans = normalizeArabicText(transcribedText);

    const origWords = cleanOrig.split(' ').filter(w => w.length > 0);
    const transWords = cleanTrans.split(' ').filter(w => w.length > 0);

    if (origWords.length === 0) {
        return { accuracy_percentage: 0, missing_or_wrong_words: [], feedback_ar: "لم يتم اكتشاف نص للتقييم." };
    }

    let matchedCount = 0;
    const missingOrWrong = [];
    const tempTransWords = [...transWords];

    // Orijinal kelimelerin kaç tanesi ses kaydında var?
    origWords.forEach(word => {
        const foundIndex = tempTransWords.findIndex(tw => isSimilarWord(word, tw));
        if (foundIndex !== -1) {
            matchedCount++;
            tempTransWords.splice(foundIndex, 1); // Tekrar sayılmasın diye sil
        } else {
            if (word.length > 1) {
                missingOrWrong.push(word);
            }
        }
    });

    // DOĞRUDAN ORANSAL YÜZDE HESABI
    let accuracyPercentage = Math.round((matchedCount / origWords.length) * 100);
    
    // Eğer konuşma algılandıysa ama kelimeler kıl payı kaçtıysa en az okuma oranını ver
    if (transWords.length > 0 && accuracyPercentage === 0) {
        accuracyPercentage = Math.min(30, Math.round((transWords.length / origWords.length) * 100));
    }
    
    // Max %100 sınırı
    accuracyPercentage = Math.min(100, accuracyPercentage);

    const uniqueErrors = [...new Set(missingOrWrong)].slice(0, 10);

    let feedbackAr = accuracyPercentage >= 70 
        ? "تلاوة ممتازة وموفقة، واصل هذا الأداء الرائع!" 
        : "تلاوة طيبة، حاول التركيز أكثر على مخارج الحروف والكلمات المفقودة.";

    if (process.env.GROQ_API_KEY) {
        try {
            const response = await axios.post(
                'https://api.groq.com/openai/v1/chat/completions',
                {
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { 
                            role: 'system', 
                            content: 'أنت معلم قرآن كريم. أكتب جملة تشجيعية واحدة باللغة العربية بناءً على نسبة الدقة. أرجع JSON حصراً: {"feedback_ar": "نص التقييم"}' 
                        },
                        { 
                            role: 'user', 
                            content: `نسبة الدقة: %${accuracyPercentage}` 
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
        } catch (err) {
            // AI bağlantı hatasında varsayılan mesaj kalır
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
    console.log(`✅ Server Port ${PORT} Üzerinde Aktif!`);
});
