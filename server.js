require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

/**
 * Kelime Bazlı Katı Doğruluk ve Analiz Fonksiyonu
 */
async function analyzeRecitationWithLLM(originalText, transcribedText) {
    // 1. Arapça karakter temizleme (Harekeler ve noktalama işaretleri çıkarılır)
    const cleanArabic = (text) => {
        return text
            .replace(/[\u064B-\u065F\u0670]/g, '') // Harekeler
            .replace(/[﴿﴾0-9]/g, '')               // Ayet numaraları
            .replace(/[^\u0600-\u06FF\s]/g, '')    // Sadece Arapça harfler
            .trim();
    };

    const cleanOriginal = cleanArabic(originalText);
    const cleanTranscribed = cleanArabic(transcribedText);

    const origWords = cleanOriginal.split(/\s+/).filter(w => w.length > 0);
    const transWords = cleanTranscribed.split(/\s+/).filter(w => w.length > 0);

    // 2. Matematiksel Doğruluk Skorlama
    let correctMatches = 0;
    const missingOrWrong = [];

    origWords.forEach(word => {
        if (transWords.includes(word)) {
            correctMatches++;
        } else {
            missingOrWrong.push(word);
        }
    });

    const calculatedAccuracy = origWords.length > 0 
        ? Math.round((correctMatches / origWords.length) * 100) 
        : 0;

    // 3. Yapay Zeka Feedback Oluşturma
    const systemPrompt = `
    Sen bir Kur'an-ı Kerيم Değerlendirme Uzmanısın.
    Kullanıcının okuduğu metin ile orijinal metin karşılaştırıldı. 
    Lütfen kullanıcıya Arapça dilinde, nazik ve teşvik edici tek cümlelik bir değerlendirme yaz.
    
    YALNIZCA GEÇERLİ JSON DÖNDÜR:
    {
      "feedback_ar": "Arapça kısa değerlendirme cümlesi"
    }
    `;

    try {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'llama-3.3-70b-versatile',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Orijinal: ${cleanOriginal}\nOkunan: ${cleanTranscribed}` }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.1
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            }
        );

        const aiFeedback = JSON.parse(response.data.choices[0].message.content);

        return {
            accuracy_percentage: calculatedAccuracy,
            missing_or_wrong_words: [...new Set(missingOrWrong)], // Tekrarlayan kelimeleri temizle
            feedback_ar: aiFeedback.feedback_ar || "تمت التقييم بنجاح."
        };
    } catch (error) {
        return {
            accuracy_percentage: calculatedAccuracy,
            missing_or_wrong_words: [...new Set(missingOrWrong)],
            feedback_ar: "تمت مراجعة التلاوة حسب الكلمات المطابقة."
        };
    }
}

app.post('/api/analyze-text', async (req, res) => {
    try {
        const { originalText, transcribedText } = req.body;
        if (!originalText || !transcribedText) {
            return res.status(400).json({ success: false, message: 'Nص غير مكتمل.' });
        }

        const analysisResult = await analyzeRecitationWithLLM(originalText, transcribedText);
        return res.json({ success: true, data: analysisResult });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Kur'an Ezber Server Aktif! Port: ${PORT}`);
});
