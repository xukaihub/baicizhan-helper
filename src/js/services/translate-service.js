;(function(global) {
    'use strict';

    // 翻译引擎接口
    class TranslationEngine {
        async translate(text, from = 'auto', to = null) {
            throw new Error('Not implemented');
        }
    }

    // Google 翻译引擎实现
    class GoogleTranslationEngine extends TranslationEngine {
        async translate(text, from = 'auto', to = null) {
            if (!to) {
                to = this.isEnglishPhrase(text) ? 'zh-CN' : 'en';
            }

            const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t';
            
            console.log('Google translate request:', {
                url,
                from,
                to,
                textLength: text.length
            });
            
            const response = await fetch(
                `${url}&sl=${from}&tl=${to}&q=${encodeURIComponent(text)}`,
                {
                    method: 'GET',
                    headers: {
                        'origin': 'https://translate.google.com',
                        'referer': 'https://translate.google.com/',
                        'accept': 'application/json',
                        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
                        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                    }
                }
            );

            if (!response.ok) {
                throw new Error(`Google translation failed: ${response.status}`);
            }

            const result = await response.json();
            
            if (result && result[0]) {
                const translation = result[0]
                    .filter(item => item && item[0])
                    .map(item => item[0])
                    .join('');
                
                console.log('Found translation:', translation);
                return translation;
            }
            
            throw new Error('Invalid response from Google Translate');
        }

        isEnglishPhrase(text) {
            let len = 0, characterSize = 0;
            for (let c of Array.from(text)) {
                if (c === ' ') continue;
                len++;
                if (c >= 'A' && c <= 'z') characterSize++;
            }
            return characterSize / len > 0.7;
        }
    }

    // 翻译服务类
    class TranslationService {
        constructor(engine = new GoogleTranslationEngine()) {
            this.engine = engine;
            this.maxChunkSize = 1000;
        }

        setEngine(engine) {
            this.engine = engine;
        }

        async translate(text, from = 'auto', to = null) {
            if (text.length > this.maxChunkSize) {
                return this.translateLongText(text, from, to);
            }
            
            try {
                const translation = await this.engine.translate(text, from, to);
                return {
                    translatedText: translation
                };
            } catch (error) {
                console.error('Translation error:', error);
                throw error;
            }
        }

        async translateLongText(text, from = 'auto', to = null) {
            try {
                const sentences = this.splitIntoSentences(text);
                const chunks = [];
                let currentChunk = '';

                for (const sentence of sentences) {
                    if ((currentChunk + sentence).length > this.maxChunkSize) {
                        chunks.push(currentChunk.trim());
                        currentChunk = sentence;
                    } else {
                        currentChunk += ' ' + sentence;
                    }
                }
                if (currentChunk) {
                    chunks.push(currentChunk.trim());
                }

                console.log('Split into chunks:', chunks);

                const translations = [];
                for (const chunk of chunks) {
                    const translation = await this.engine.translate(chunk, from, to);
                    translations.push(translation);
                }

                return {
                    translatedText: translations.join(' ')
                };
            } catch (error) {
                console.error('Translation error:', error);
                throw error;
            }
        }

        splitIntoSentences(text) {
            const sentenceRegex = /[^.!?。！？]+[.!?。！？]+/g;
            const sentences = text.match(sentenceRegex) || [text];
            
            const lastPart = text.replace(sentenceRegex, '').trim();
            if (lastPart) {
                sentences.push(lastPart);
            }
            
            return sentences.map(s => s.trim()).filter(s => s);
        }
    }

    // 导出模块
    const translationService = new TranslationService();
    global.translationService = translationService;

}(this));