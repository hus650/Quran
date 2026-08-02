require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.static('public'));

// Groq Whisper API ile Sesi Metne Çevirme
async function transcribeAudio(filePath) {
  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath));
  formData.append('model', 'whisper-large-v3');
  formData.append('language', 'ar');

  const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      ...formData.getHeaders(),
    },
  });

  return response.data.text;
}

// Groq LLM ile Karşılaştırma Analizi
async function analyzeRecitation(originalText, transcribedText) {
  const prompt = `
  Aşağıda orijinal Kuran metni ve kullanıcının okuduğu metin verilmiştir.
  İki metni karşılaştır ve analizi YALNIZCA geçerli bir JSON formatında döndür. Başka hiçbir açıklama yazma.

  JSON Formatı:
  {
    "accuracy_percentage": 0-100 arası sayı,
    "transcribed_text": "okunan metin",
    "original_text": "orijinal metin",
    "missing_or_wrong_words": ["hatalı veya eksik kelimelerin listesi"],
    "feedback_ar": "Arapça olarak kullanıcıya kısa değerlendirme ve tavsiye"
  }

  Orijinal Metin: ${originalText}
  Kullanıcının Okuduğu: ${transcribedText}
  `;

  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return JSON.parse(response.data.choices[0].message.content);
}

// API Endpoint: Ses Analizi
app.post('/api/analyze', upload.single('audio'), async (req, res) => {
  try {
    const originalText = req.body.originalText;
    const audioPath = req.file.path;

    // 1. Sesi Metne Çevir (STT)
    const transcribedText = await transcribeAudio(audioPath);

    // 2. Metinleri Kıyasla (LLM)
    const result = await analyzeRecitation(originalText, transcribedText);

    // Geçici ses dosyasını sil
    fs.unlinkSync(audioPath);

    res.json({ success: true, data: result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء المعالجة' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));