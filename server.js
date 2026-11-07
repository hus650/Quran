// Sesli okuma ve akıllı kelime kontrolü başlatma
    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.start();

            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (SpeechRecognition) {
                recognition = new SpeechRecognition();
                recognition.lang = 'ar-SA';
                recognition.continuous = true; // Duraklamalarda kapanmayı önler, sürekli dinler
                recognition.interimResults = true;

                recognition.onresult = (event) => {
                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        const transcript = event.results[i][0].transcript.trim();
                        checkAndRevealWordsStrict(transcript);
                    }
                };

                // Eğer tarayıcı sessizlikten dolayı durursa otomatik yeniden başlat (Kesintisiz deneyim için)
                recognition.onend = () => {
                    if (document.getElementById('recordingStatus').style.display === 'block') {
                        try { recognition.start(); } catch (e) {}
                    }
                };

                recognition.start();
            }

            document.getElementById('startBtn').disabled = true;
            document.getElementById('stopBtn').disabled = false;
            document.getElementById('surahSelect').disabled = true;
            document.getElementById('recordingStatus').style.display = 'block';
            document.getElementById('resultBox').style.display = 'none';
        } catch (error) {
            alert('يرجى السماح باستخدام الميكروفون.');
        }
    }

    // YANLIŞ KELİMEDE AÇMAYAN VE DÜŞÜNME PAYI BIRAKAN AKILLI KONTROL
    function checkAndRevealWordsStrict(spokenText) {
        const spokenWords = spokenText.split(' ');
        const latestSpokenWord = spokenWords[spokenWords.length - 1]; // En son söylenen kelimeye odaklan
        
        const cleanedSpoken = cleanText(latestSpokenWord);
        if (!cleanedSpoken) return;

        // Sıradaki hedef kelimeyi al
        if (currentWordIndex < wordSpans.length) {
            const targetWord = wordSpans[currentWordIndex].dataset.word;

            // Kelime eşleşiyor mu kontrol et (Esnek benzerlik)
            if (targetWord.includes(cleanedSpoken) || cleanedSpoken.includes(targetWord) || isSimilarWord(targetWord, cleanedSpoken)) {
                // DOĞRU KELİME: Aç ve bir sonraki kelimeye geç
                wordSpans[currentWordIndex].classList.add('revealed');
                currentWordIndex++;
            } else {
                // YANLIŞ KELİME: Kesinlikle açma! Kullanıcının düzeltmesini veya düşünmesini bekle.
                // İsteğe bağlı olarak yanlış okunan kelimeyi görsel olarak hafifçe uyarabilirsin.
            }
        }
    }

    // Sunucu tarafındaki esnek kelime karşılaştırma mantığı (Burada da destekleniyor)
    function isSimilarWord(w1, w2) {
        if (!w1 || !w2) return false;
        if (w1 === w2) return true;
        if (Math.abs(w1.length - w2.length) > 2) return false;

        let matches = 0;
        const minLen = Math.min(w1.length, w2.length);
        for (let i = 0; i < minLen; i++) {
            if (w1[i] === w2[i]) matches++;
        }
        return (matches / Math.max(w1.length, w2.length)) >= 0.65;
    }
