;(function(window, document, $) {
    'use strict';

    const $doc = $(document);

    async function checkUpgrade() {
        let latestVersion = await apiModule.getLatestVersion();
        let currentVersion = window.__baicizhanHelper__.version;
        let hasNewVersion = latestVersion > currentVersion;

        if (hasNewVersion) {
            let $tips = $('#versionTips');
            $tips.find('strong').text(currentVersion);
            $tips.show();            
        }
    }

    async function init() {
        loginModule.init();
        settingModule.init();
        wordbookModule.init();
        studyModule.init();
        checkUpgrade();

        // 批量导入功能初始化
        initImportFeature();

        let accessToken = await storageModule.get('accessToken');
        let event = accessToken ? events.AUTHED : events.UNAUTHED;

        $doc.trigger(event);
    }

    // 添加初始化导入功能的函数
    function initImportFeature() {
        const importButton = document.getElementById('importWords');
        const fileInput = document.getElementById('importFile');
        const importProgress = document.getElementById('importProgress');
        const progressBar = importProgress.querySelector('.progress-bar');
        const importedCount = document.getElementById('importedCount');
        const totalImportCount = document.getElementById('totalImportCount');

        if (!importButton || !fileInput) {
            console.error('导入功能初始化失败：找不到必要的DOM元素');
            return;
        }

        console.log('初始化导入功能');

        importButton.addEventListener('click', (e) => {
            e.preventDefault();  // 阻止默认行为
            e.stopPropagation();  // 阻止事件冒泡
            console.log('点击导入按钮');
            fileInput.click();
        });

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                console.log('开始导入文件');
                importButton.disabled = true;
                const text = await file.text();
                const words = text.split('\n')
                    .map(word => word.trim())
                    .map(word => word.replace(/\s+/g, ''))
                    .filter(word => word && /^[a-zA-Z-]+$/.test(word));

                console.log('解析到的单词:', words);

                if (words.length === 0) {
                    showMessage('没有找到有效的单词');
                    return;
                }

                importProgress.style.display = 'block';
                totalImportCount.textContent = words.length;
                importedCount.textContent = '0';
                progressBar.style.width = '0%';

                let imported = 0;
                let skipped = 0;
                let failed = 0;

                // 获取当前单词本ID
                const bookId = $('#wordbookSelect').val() || await storageModule.get('bookId') || 0;
                console.log('当前单词本ID:', bookId);
                
                // 获取已收藏的单词列表
                const collectedWords = await window.wordbookStorageModule.WordbookStorage.load(bookId);
                console.log('已收藏的单词数量:', collectedWords.length);
                const collectedWordsSet = new Set(collectedWords.map(w => w.word.toLowerCase()));

                for (const word of words) {
                    try {
                        console.log('处理单词:', word);
                        // 检查是否已收藏
                        if (collectedWordsSet.has(word.toLowerCase())) {
                            console.log('单词已收藏，跳过:', word);
                            skipped++;
                            continue;
                        }

                        // 获取单词信息
                        const wordInfo = await window.apiModule.getWordInfo(word);
                        console.log('获取到的单词信息:', wordInfo);
                        
                        if (!wordInfo) {
                            console.log('未找到单词信息:', word);
                            failed++;
                            continue;
                        }

                        // 收藏单词
                        const result = await window.apiModule.collectWord(wordInfo.dict);
                        console.log('收藏结果:', result);
                        
                        if (result) {
                            imported++;
                        } else {
                            failed++;
                        }

                        // 更新进度
                        const processed = imported + skipped + failed;
                        importedCount.textContent = `${imported}${skipped > 0 ? ` (已跳过 ${skipped} 个)` : ''}`;
                        progressBar.style.width = `${(processed / words.length) * 100}%`;

                        // 每处理5个单词暂停一下，避免请求过快
                        if (processed % 5 === 0) {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }

                    } catch (error) {
                        console.error(`导入单词 ${word} 失败:`, error);
                        failed++;
                    }
                }

                console.log('导入完成统计:', { imported, skipped, failed });

                const message = [];
                if (imported > 0) message.push(`成功导入 ${imported} 个`);
                if (skipped > 0) message.push(`跳过 ${skipped} 个已收藏的`);
                if (failed > 0) message.push(`失败 ${failed} 个`);
                
                showMessage(`导入完成! ${message.join('，')}`);

            } catch (error) {
                console.error('导入过程出错:', error);
                showMessage('导入失败: ' + error.message);
            } finally {
                importButton.disabled = false;
                fileInput.value = ''; // 清空文件选择
                setTimeout(() => {
                    importProgress.style.display = 'none';
                }, 3000);
            }
        });
    }

    window.onload = init;

    // 添加导出功能
    async function exportAllToAnki() {
        const exportBtn = document.getElementById('exportToAnki');
        const progressDiv = document.getElementById('exportProgress');
        const progressBar = progressDiv.querySelector('.progress-bar');
        const exportedCount = document.getElementById('exportedCount');
        const totalCount = document.getElementById('totalCount');

        try {
            exportBtn.disabled = true;
            exportBtn.textContent = '导出中...';
            
            const bookId = $('#wordbookSelect').val() || await storageModule.get('bookId') || 0;
            const words = await window.wordbookStorageModule.WordbookStorage.load(bookId);
            
            if (!words || words.length === 0) {
                showMessage('没有找到收藏的单词');
                return;
            }
            
            progressDiv.style.display = 'block';
            totalCount.textContent = words.length;
            exportedCount.textContent = '0';
            progressBar.style.width = '0%';
            
            const ankiService = new AnkiService();
            let exported = 0;
            let skipped = 0;

            try {
                await ankiService.invoke('version');
            } catch (error) {
                showMessage('请确保 Anki 正在运行且已安装 AnkiConnect 插件');
                return;
            }

            const models = await ankiService.invoke('modelNames');
            if (!models.includes('BaiCiZhan Basic')) {
                await ankiService.createBasicModel();
            }

            const settings = await chrome.storage.local.get(['ankiSettings']);
            const ankiSettings = settings.ankiSettings || {
                enabled: true,
                deckName: 'English Vocabulary',
                exportPhonetic: true,
                exportAudio: true,
                exportMeaning: true,
                exportSentence: true,
                exportImage: true,
                exportVariants: true,
                exportPhrases: true,
                exportSynonyms: true,
                exportAntonyms: true,
                exportEnMeans: true
            };

            const decks = await ankiService.invoke('deckNames');
            if (!decks.includes(ankiSettings.deckName)) {
                await ankiService.createDeck(ankiSettings.deckName);
            }

            for (const wordItem of words) {
                try {
                    progressBar.style.width = `${((exported + skipped) / words.length) * 100}%`;
                    progressBar.textContent = `${Math.round(((exported + skipped) / words.length) * 100)}%`;
                    exportedCount.textContent = `${exported}${skipped > 0 ? ` (已跳过 ${skipped} 个重复单词)` : ''}`;

                    const wordDetail = await window.apiModule.getWordDetail(wordItem.topic_id);
                    if (!wordDetail) {
                        skipped++;
                        continue;
                    }

                    const wordData = {
                        word: wordDetail.dict.word_basic_info.word,
                        accent: wordDetail.dict.word_basic_info.accent_uk,
                        meaning: wordDetail.dict.chn_means.map(m => ({
                            type: m.mean_type,
                            mean: m.mean
                        })),
                        image: wordDetail.dict.sentences?.[0]?.img_uri ? 
                               'https://7n.bczcdn.com' + wordDetail.dict.sentences[0].img_uri : '',
                        sentence: wordDetail.dict.sentences?.[0]?.sentence || '',
                        sentenceTrans: wordDetail.dict.sentences?.[0]?.sentence_trans || '',
                        audioUrl: 'https://7n.bczcdn.com' + wordDetail.dict.word_basic_info.accent_uk_audio_uri,
                        variants: wordDetail.dict.variant_info || null,
                        shortPhrases: wordDetail.dict.short_phrases || [],
                        synonyms: wordDetail.dict.synonyms || [],
                        antonyms: wordDetail.dict.antonyms || [],
                        enMeans: wordDetail.dict.en_means || []
                    };

                    const canAdd = await ankiService.canAddNote(
                        wordData.word,
                        wordData.accent,
                        wordData.meaning.map(m => `${m.type} ${m.mean}`).join('; ')
                    );

                    if (!canAdd) {
                        skipped++;
                        continue;
                    }

                    const result = await ankiService.addNote(
                        wordData.word,
                        wordData.accent,
                        wordData.meaning,
                        wordData.image,
                        wordData.sentence,
                        wordData.sentenceTrans,
                        wordData.audioUrl,
                        wordData.variants,
                        wordData.shortPhrases,
                        wordData.synonyms,
                        wordData.antonyms,
                        wordData.enMeans
                    );
                    
                    if (result) exported++;

                    if ((exported + skipped) % 5 === 0) {
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }

                } catch (err) {
                    console.error(`导出单词 ${wordItem.word} 失败:`, err);
                    skipped++;
                }
            }

            const message = exported > 0 ? 
                `导出完成! 成功导出 ${exported} 个单词${skipped > 0 ? `，跳过 ${skipped} 个重复单词` : ''}` : 
                '没有新的单词需要导出';
            showMessage(message);

        } catch (err) {
            showMessage('导出失败: ' + err.message);
        } finally {
            exportBtn.disabled = false;
            exportBtn.textContent = '一键导出所有单词到 Anki';
            setTimeout(() => {
                progressDiv.style.display = 'none';
            }, 3000);
        }
    }

    // 显示消息提示
    function showMessage(msg) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'alert alert-info';
        messageDiv.style.position = 'fixed';
        messageDiv.style.top = '20px';
        messageDiv.style.right = '20px';
        messageDiv.style.zIndex = '9999';
        messageDiv.textContent = msg;
        document.body.appendChild(messageDiv);
        
        setTimeout(() => {
            messageDiv.remove();
        }, 3000);
    }

    // 确保在文档加载完成后添加事件监听
    document.addEventListener('DOMContentLoaded', function() {
        // ... 其他初始化代码 ...
        
        // Anki 导出相关
        const enableAnkiExport = document.getElementById('enableAnkiExport');
        const autoExportToAnki = document.getElementById('autoExportToAnki');
        const exportToAnki = document.getElementById('exportToAnki');
        const ankiSettingsDetails = document.getElementById('ankiSettingsDetails');
        
        // 初始化时检查 Anki 设置状态
        chrome.storage.local.get(['ankiSettings'], function(result) {
            const ankiSettings = result.ankiSettings || { 
                enabled: false,
                autoExport: false 
            };
            
            enableAnkiExport.checked = ankiSettings.enabled;
            autoExportToAnki.checked = ankiSettings.autoExport;
            exportToAnki.disabled = !ankiSettings.enabled;
            ankiSettingsDetails.style.display = ankiSettings.enabled ? 'block' : 'none';
            autoExportToAnki.disabled = !ankiSettings.enabled;
        });

        // 监听 Anki 启用状态变化
        enableAnkiExport.addEventListener('change', async function(e) {
            const enabled = e.target.checked;
            
            // 更新界面状态
            exportToAnki.disabled = !enabled;
            ankiSettingsDetails.style.display = enabled ? 'block' : 'none';
            autoExportToAnki.disabled = !enabled;
            
            // 如果禁用了 Anki 导出，同时也禁用自动导出
            if (!enabled) {
                autoExportToAnki.checked = false;
            }

            // 保存设置
            const settings = await chrome.storage.local.get(['ankiSettings']);
            const ankiSettings = settings.ankiSettings || {};
            ankiSettings.enabled = enabled;
            ankiSettings.autoExport = enabled ? autoExportToAnki.checked : false;
            await chrome.storage.local.set({ ankiSettings });
        });

        // 监听自动导出状态变化
        autoExportToAnki.addEventListener('change', async function(e) {
            const autoExport = e.target.checked;
            
            // 保存设置
            const settings = await chrome.storage.local.get(['ankiSettings']);
            const ankiSettings = settings.ankiSettings || {};
            ankiSettings.autoExport = autoExport;
            await chrome.storage.local.set({ ankiSettings });
        });

        // 导出按钮事件监听
        if (exportToAnki) {
            exportToAnki.addEventListener('click', exportAllToAnki);
        }

        // 在 DOMContentLoaded 事件处理中修改
        const enablePageHighlight = document.getElementById('enablePageHighlight');

        // 加载设置
        chrome.storage.local.get(['highlightSettings'], function(result) {
            const settings = result.highlightSettings || { enabled: true };  // 默认为 true
            enablePageHighlight.checked = settings.enabled;
            
            // 如果是首次加载，保存默认设置
            if (!result.highlightSettings) {
                chrome.storage.local.set({
                    highlightSettings: { enabled: true }
                });
            }
        });

        // 保存设置
        enablePageHighlight.addEventListener('change', function(e) {
            const enabled = e.target.checked;
            chrome.storage.local.set({
                highlightSettings: { enabled }
            });
            
            // 通知所有标签页刷新高亮状态
            chrome.tabs.query({}, function(tabs) {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, {
                        type: 'updateHighlightSettings',
                        enabled: enabled
                    }).catch(() => {});  // 忽略不支持的标签页错误
                });
            });
        });
    });
} (this, document, jQuery));