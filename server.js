require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `recitation-${Date.now()}.wav`)
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 25 * 1024 * 1024 }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

/**
 * Katı LLM Karşılaştırma Analizi
 */
async function analyzeRecitationWithLLM(originalText, transcribedText) {
    const systemPrompt = `
    Sen strict (titiz) bir Kur'an-ı Kerim Değerlendirme Uzmanısın.
    Görevin: Kullanıcının okuduğu metni (transcribed_text) ile orijinal ayetleri (original_text) KELİME KELİME karşılaştırmaktır.

    DEĞERLENDİRME KURALLARI:
    1. YANLIŞ/EKSİK KELİME: Kullanıcı orijinal metindeki bir kelimeyi atladıysa veya yanlış okuduysa bunu "missing_or_wrong_words" listesine ekle.
    2. %100 YALANI YAPMA: Eğer kullanıcı metni yanlış okuduysa VEYA eksik okuduysa KESİNLİKLE %100 verme! Gerçekçi bir skor hesapla.
    3. BAŞLANGIÇ ESNEKLİĞİ: Kullanıcı surenin ortasındaki bir ayetten başladıysa, okumadığı önceki ayetleri HATA sayma. Sadece okumaya başladığı yerden itibaren değerlendir.
    4. REVEALED VERSES: Doğru okunan veya kabul edilebilir ayet numaralarını "revealed_verse_numbers" dizisine yaz.

    ÇIKTI FORMATI (YALNIZCA JSON):
    {
      "accuracy_percentage": (0-100 arası integer),
      "transcribed_text": "${transcribedText.replace(/"/g, '\\"')}",
      "revealed_verse_numbers": [1, 2, 3],
      "missing_or_wrong_words": ["hatalı veya eksik kelimeler"],
      "feedback_ar": "Arapça kısa ve dürüst değerlendirme notu."
    }
    `;

    const userPrompt = `
    Orijinal Kur'an Metni: ${originalText}
    Kullanıcının Okuduğu Metin: ${transcribedText}
    `;

    try {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'llama-3.3-70b-versatile',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.0
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        return JSON.parse(response.data.choices[0].message.content);
    } catch (error) {
        console.error("LLM Analiz Hatası:", error.message);
        throw new Error("Analiz yapılırken sunucu hatası oluştu.");
    }
}

app.post('/api/analyze-text', async (req, res) => {
    try {
        const { originalText, transcribedText } = req.body;
        if (!originalText || !transcribedText) {
            return res.status(400).json({ success: false, message: 'Eksik veri gönderildi.' });
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
