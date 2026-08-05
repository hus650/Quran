require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const app = express();

// ---------------------------------------------------------------
// 1. DİZİN VE YÜKLEME AYARLARI (DIRECTORY & UPLOAD CONFIGURATION)
// ---------------------------------------------------------------
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Dosya yükleme konfigürasyonu (Multer Disk Storage)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `recitation-${uniqueSuffix}.wav`);
    }
});

// Güvenlik: Yalnızca ses dosyalarına izin ver ve maksimum 25MB sınırla
const upload = multer({
    storage: storage,
    limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB Limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('audio/')) {
            cb(null, true);
        } else {
            cb(new Error('Yalnızca ses dosyaları yüklenebilir!'), false);
        }
    }
});

// Middleware Yapılandırması
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(__dirname));

// Ana Sayfa Route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ---------------------------------------------------------------
// 2. WHISPER SPEECH-TO-TEXT SERVİSİ (GROQ API INTEGRATION)
// ---------------------------------------------------------------
/**
 * Ses dosyasını Groq Whisper API'ye göndererek metne çevirir.
 * @param {string} filePath - Yüklenen geçici ses dosyasının yolu.
 * @param {string} originalText - Kur'an ayet bağlamı (Prompt optimization).
 * @returns {Promise<string>} Transkribe edilmiş Arapça metin.
 */
async function transcribeAudioWithWhisper(filePath, originalText) {
    const formData = new FormData();
    
    formData.append('file', fs.createReadStream(filePath));
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('language', 'ar');
    formData.append('temperature', '0.0'); // Yüksek doğruluk için 0
    
    // Whisper'ın Kur'an terimlerini doğru anlaması için prompt context ekleme
    if (originalText && originalText.trim().length > 0) {
        const cleanContext = originalText.replace(/[﴿﴾0-9]/g, '').substring(0, 300);
        formData.append('prompt', `تلاوة قرآنية مجودة: ${cleanContext}`);
    }

    try {
        const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                ...formData.getHeaders(),
            },
            timeout: 90000 // 90 saniye zaman aşımı
        });

        if (!response.data || !response.data.text) {
            throw new Error("Whisper API boş veya geçersiz yanıt döndürdü.");
        }

        return response.data.text.trim();
    } catch (error) {
        console.error("Whisper Transkripsiyon Hatası:", error.response ? error.response.data : error.message);
        throw new Error("Ses metne dönüştürülürken bir hata oluştu.");
    }
}

// ---------------------------------------------------------------
// 3. LLM KUR'AN KARŞILAŞTIRMA VE ANALİZ SERVİSİ
// ---------------------------------------------------------------
/**
 * Orijinal Kur'an metni ile okunan metni karşılaştırır ve JSON döndürür.
 * @param {string} originalText - Orijinal Ayetler.
 * @param {string} transcribedText - Whisper'ın çıkardığı metin.
 * @returns {Promise<Object>} Analiz sonuç objesi.
 */
async function analyzeRecitationWithLLM(originalText, transcribedText) {
    const systemPrompt = `
    Sen dünya standartlarında bir Kur'an-ı Kerيم, Tecvid ve Hafızlık Değerlendirme Uzmanısın.
    Görevin: Kullanıcının okuduğu metni orijinal Kur'an metni ile karşılaştırmak ve detaylı analiz çıkarmaktır.

    DEĞERLENDİRME KRİTERLERİ VE ESNEKLİK KURALLARI:
    1. YAVAŞ OKUMA VEYA DURAKSALAR: Kullanıcı ezberden okurken düşünebilir veya duraklayabilir. Duraksamaları KESİNLİKLE HATA SAYMA.
    2. KELİME TEKRARLARI: Kullanıcı takılıp aynı kelimeyi veya ayet başını tekrar ettiyse, en son doğru telaffuzunu baz al. Tekrarları hata sayma.
    3. HAREKE VE UZATMA (MED) FARKLILIKLARI: Harekelerin veya tecvid uzatmalarının yazıda farklı çıkmasını tolere et.
    4. HATA TANIMI: Yalnızca kelimenin tamamen atlanması (eksik okuma) veya başka bir kelimeyle değiştirilmesi durumlarını "hata" olarak işaretle.
    5. AYET AÇMA (REVEAL): Kullanıcının doğru veya kabul edilebilir şekilde okuduğu tüm ayetlerin numaralarını "revealed_verse_numbers" dizisine ekle.

    ZORUNLU ÇIKTI FORMATI (YALNIZCA GEÇERLİ JSON DÖNDÜR, BAŞKA HİÇBİR METİN VEYA AÇIKLAMA YAZMA):
    {
      "accuracy_percentage": (0-100 arası integer sayı),
      "transcribed_text": "${transcribedText.replace(/"/g, '\\"')}",
      "revealed_verse_numbers": [1, 2, 3], 
      "missing_or_wrong_words": ["Hatalı veya tamamen atlanan kelimelerin listesi"],
      "feedback_ar": "Kullanıcıya Arapça dilinde sunulacak, tecvid ve ezber başarısını öven, eksikler varsa nazikçe belirten yapıcı değerlendirme."
    }
    `;

    const userPrompt = `
    Orijinal Kur'an Metni:
    ${originalText}

    Kullanıcının Okuduğu Metin:
    ${transcribedText}
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
                temperature: 0.1
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 90000
            }
        );

        const content = response.data.choices[0].message.content;
        return JSON.parse(content);
    } catch (error) {
        console.error("LLM Analiz Hatası:", error.response ? error.response.data : error.message);
        throw new Error("Tilavet analizi yapılırken yapay zeka sunucusunda hata oluştu.");
    }
}

// ---------------------------------------------------------------
// 4. API ENDPOINTS & DOSYA TEMİZLİK GÜVENLİĞİ (SAFE CLEANUP)
// ---------------------------------------------------------------
app.post('/api/analyze', upload.single('audio'), async (req, res) => {
    let audioFilePath = null;

    try {
        // Dosya kontrolü
        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                message: 'لم يتم استلام أي ملف صوتي. يرجى محاولة التسجيل مجدداً.' 
            });
        }

        audioFilePath = req.file.path;
        const originalText = req.body.originalText;

        if (!originalText || originalText.trim() === '') {
            return res.status(400).json({ 
                success: false, 
                message: 'نص السورة الأصلية غير موجود.' 
            });
        }

        // Step 1: Voice to Text (Whisper API)
        const transcribedText = await transcribeAudioWithWhisper(audioFilePath, originalText);

        // Step 2: Recitation Analysis (LLM)
        const analysisResult = await analyzeRecitationWithLLM(originalText, transcribedText);

        // Başarılı yanıt gönder
        return res.json({
            success: true,
            data: analysisResult
        });

    } catch (error) {
        console.error("API /api/analyze Hatası:", error.message);
        return res.status(500).json({
            success: false,
            message: error.message || 'حدث خطأ غير متوقع أثناء معالجة الصوت.'
        });
    } finally {
        // Otomatik Temizlik: Yüklenen geçici ses dosyasını mutlaka sil
        if (audioFilePath && fs.existsSync(audioFilePath)) {
            fs.unlink(audioFilePath, (err) => {
                if (err) console.error("Geçici dosya silinirken hata oluştu:", err);
            });
        }
    }
});

// Genel Hata Yakalama Middleware
app.use((err, req, res, next) => {
    console.error("Global Server Error:", err.stack);
    res.status(500).json({
        success: false,
        message: 'حدث خطأ في الخادم الداخلي.'
    });
});

// ---------------------------------------------------------------
// 5. SUNUCUYU BAŞLATMA (SERVER INITIALIZATION)
// ---------------------------------------------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(`🚀 Kur'an Ezber Server Aktif! Port: ${PORT}`);
    console.log(`🌐 Adres: http://localhost:${PORT}`);
    console.log(`=================================================`);
});
