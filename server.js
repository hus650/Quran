require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const app = express();

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Yüklenen dosyaları doğru uzantı ile kaydet
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '.wav')
  }
});
const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Groq Whisper API - Optimize Edilmiş
async function transcribeAudio(filePath) {
  const formData = new FormData();
  
  formData.append('file', fs.createReadStream(filePath));
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('language', 'ar');

  const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      ...formData.getHeaders(),
    },
    timeout: 60000 // Timeout süresi 60 saniyeye çıkarıldı
  });

  return response.data.text;
}

// Groq LLM Analiz
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
      },
      timeout: 60000
    }
  );

  return JSON.parse(response.data.choices[0].message.content);
}

// API Endpoint
app.post('/api/analyze', upload.single('audio'), async (req, res) => {
  let audioPath = null;
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Ses dosyası alınamadı' });
    }

    const originalText = req.body.originalText;
    audioPath = req.file.path;

    const transcribedText = await transcribeAudio(audioPath);
    const result = await analyzeRecitation(originalText, transcribedText);

    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }

    res.json({ success: true, data: result });
  } catch (error) {
    console.error("Hata Detayı:", error.response ? error.response.data : error.message);
    
    if (audioPath && fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }
    
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء المعالجة' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
