;(function(window, document) {
    'use strict';

    class ContentHighlighter {
        constructor() {
            this.collectedWords = new Set();
            this.popover = null;
            this.initialized = false;
            this.observer = null;
            this.highlightDebounceTimer = null;
            this.processedNodes = new WeakSet();
            this.MAX_HIGHLIGHT_WORDS = 1000;  // 最大高亮单词数
            
            // 添加消息监听
            chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
                if (message.type === 'updateHighlightSettings') {
                    if (message.enabled) {
                        this.init();
                    } else {
                        this.removeHighlights();
                    }
                }
            });
        }

        async init() {
            console.log('ContentHighlighter init started');
            
            // 首先检查是否启用了高亮功能
            const settings = await chrome.storage.local.get(['highlightSettings']);
            console.log('Highlight settings:', settings);
            
            if (!settings.highlightSettings?.enabled) {
                console.log('Highlight feature is disabled');
                return;
            }

            // 等待 DOM 加载完成
            if (document.readyState === 'loading') {
                console.log('Document still loading, waiting...');
                document.addEventListener('DOMContentLoaded', () => {
                    console.log('DOMContentLoaded fired');
                    this.initializeHighlighter();
                });
            } else {
                console.log('Document already loaded');
                this.initializeHighlighter();
            }
        }

        async initializeHighlighter() {
            if (this.initialized) return;
            
            try {
                console.log('Initializing highlighter...');
                
                // 获取当前收藏的单词
                const bookId = await this.getCurrentBookId();
                console.log('Current book ID:', bookId);
                
                if (!window.wordbookStorageModule) {
                    console.error('wordbookStorageModule not found');
                    return;
                }

                const words = await window.wordbookStorageModule.WordbookStorage.load(bookId);
                console.log('Loaded words:', words?.length || 0);
                
                if (!words || words.length === 0) return;

                // 如果单词数量超过限制，进行筛选
                if (words.length > this.MAX_HIGHLIGHT_WORDS) {
                    const filteredWords = this.filterWords(words);
                    words.length = 0;
                    words.push(...filteredWords);
                }

                // 将单词添加到集合中
                words.forEach(word => {
                    if (word && word.word) {
                        this.collectedWords.add({
                            word: word.word.toLowerCase(),
                            mean: Array.isArray(word.means) ? word.means.join('; ') : word.mean,
                            accent: word.accent || '',
                            frequency: word.frequency || 0,  // 添加频率信息
                            lastUsed: word.created_at || Date.now()  // 添加最后使用时间
                        });
                    }
                });

                console.log('Collected words size:', this.collectedWords.size);

                if (this.collectedWords.size === 0) {
                    console.log('No valid words to highlight');
                    return;
                }

                // 初始化 popover
                this.initPopover();
                
                // 高亮单词
                this.highlightWords();
                
                // 监听 DOM 变化，处理动态加载的内容
                this.observeDOM();

                this.initialized = true;
                console.log('Highlighter initialization completed');
            } catch (error) {
                console.error('Failed to initialize highlighter:', error);
            }
        }

        async getCurrentBookId() {
            return await chrome.storage.local.get('bookId')
                .then(result => result.bookId || 0);
        }

        initPopover() {
            // 确保 body 存在
            if (!document.body) return;

            // 创建 popover 元素
            const popover = document.createElement('div');
            popover.className = 'bcz-word-popover';
            popover.style.cssText = `
                position: fixed;
                display: none;
                background: white;
                border: 1px solid #ddd;
                border-radius: 4px;
                padding: 8px 12px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                z-index: 999999;
                max-width: 300px;
                font-size: 14px;
            `;
            document.body.appendChild(popover);
            this.popover = popover;
        }

        highlightWords() {
            if (!document.body || this.collectedWords.size === 0) return;

            // 移除旧的事件监听器
            document.removeEventListener('mouseover', this.handleMouseOver.bind(this));
            document.removeEventListener('mouseout', this.handleMouseOut.bind(this));

            // 使用 requestIdleCallback 在浏览器空闲时处理
            if ('requestIdleCallback' in window) {
                window.requestIdleCallback(() => {
                    this.processHighlighting();
                    // 添加新的事件监听器
                    document.addEventListener('mouseover', this.handleMouseOver.bind(this));
                    document.addEventListener('mouseout', this.handleMouseOut.bind(this));
                });
            } else {
                // 降级使用 requestAnimationFrame
                window.requestAnimationFrame(() => {
                    this.processHighlighting();
                    // 添加新的事件监听器
                    document.addEventListener('mouseover', this.handleMouseOver.bind(this));
                    document.addEventListener('mouseout', this.handleMouseOut.bind(this));
                });
            }
        }

        processHighlighting() {
            // 创建一个包含所有单词的正则表达式
            const words = Array.from(this.collectedWords).map(info => info.word);
            const wordsRegex = new RegExp(`\\b(${words.join('|')})\\b`, 'gi');
            
            // 获取可见区域的范围
            const viewportHeight = window.innerHeight;
            const visibleRange = {
                top: window.scrollY - 100, // 上下多处理100px的缓冲区
                bottom: window.scrollY + viewportHeight + 100
            };

            // 获取所有文本节点
            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: (node) => {
                        const parent = node.parentElement;
                        if (!parent || this.processedNodes.has(node)) return NodeFilter.FILTER_REJECT;
                        
                        // 检查节点是否在可视区域内
                        const rect = parent.getBoundingClientRect();
                        const nodeTop = rect.top + window.scrollY;
                        if (nodeTop > visibleRange.bottom || nodeTop + rect.height < visibleRange.top) {
                            return NodeFilter.FILTER_REJECT;
                        }

                        if (parent.tagName === 'SCRIPT' || 
                            parent.tagName === 'STYLE' || 
                            parent.tagName === 'NOSCRIPT' ||
                            parent.tagName === 'TEXTAREA' ||
                            parent.tagName === 'INPUT' ||
                            (parent.className && typeof parent.className === 'string' && 
                             (parent.className.includes('bcz-') || parent.className.includes('highlight')))) {
                            return NodeFilter.FILTER_REJECT;
                        }
                        
                        return /[a-zA-Z]/.test(node.textContent) ? 
                               NodeFilter.FILTER_ACCEPT : 
                               NodeFilter.FILTER_REJECT;
                    }
                }
            );

            const textNodes = [];
            let node;
            let processedCount = 0;
            const batchSize = 10; // 每批处理的节点数

            while (node = walker.nextNode()) {
                textNodes.push(node);
                if (textNodes.length >= batchSize) {
                    this.processBatch(textNodes, wordsRegex);
                    textNodes.length = 0;
                    processedCount += batchSize;

                    if (processedCount >= 100) { // 每处理100个节点
                        // 安排下一批处理
                        window.requestAnimationFrame(() => this.processHighlighting());
                        return;
                    }
                }
            }

            // 处理剩余的节点
            if (textNodes.length > 0) {
                this.processBatch(textNodes, wordsRegex);
            }
        }

        processBatch(nodes, regex) {
            nodes.forEach(textNode => {
                const text = textNode.textContent;
                if (!regex.test(text)) {
                    this.processedNodes.add(textNode);
                    return;
                }

                regex.lastIndex = 0; // 重置正则表达式
                let modified = false;
                const newText = text.replace(regex, match => {
                    modified = true;
                    const wordInfo = Array.from(this.collectedWords)
                        .find(info => info.word.toLowerCase() === match.toLowerCase());
                    return `<span class="bcz-highlighted-word" 
                                 data-word="${wordInfo.word}"
                                 data-mean="${wordInfo.mean}"
                                 data-accent="${wordInfo.accent}"
                                 style="border-bottom: 2px dashed #2196F3; cursor: pointer;">${match}</span>`;
                });

                if (modified) {
                    const span = document.createElement('span');
                    span.innerHTML = newText;
                    textNode.parentNode.replaceChild(span, textNode);
                }
                this.processedNodes.add(textNode);
            });
        }

        handleMouseOver(e) {
            const target = e.target;
            if (target.classList.contains('bcz-highlighted-word')) {
                const rect = target.getBoundingClientRect();
                this.popover.innerHTML = `
                    <div style="font-weight: bold;">${target.dataset.word}</div>
                    <div style="color: #666;">${target.dataset.accent}</div>
                    <div>${target.dataset.mean}</div>
                `;
                
                // 计算最佳显示位置
                const viewportWidth = window.innerWidth;
                const viewportHeight = window.innerHeight;
                const popoverWidth = 300; // 最大宽度
                const popoverHeight = this.popover.offsetHeight || 100; // 预估高度
                
                // 默认位置
                let left = rect.left;
                let top = rect.bottom + 5;
                
                // 检查右边界
                if (left + popoverWidth > viewportWidth) {
                    left = viewportWidth - popoverWidth - 10;
                }
                
                // 检查下边界
                if (top + popoverHeight > viewportHeight) {
                    top = rect.top - popoverHeight - 5; // 显示在单词上方
                }
                
                // 确保不会超出左边界
                left = Math.max(10, left);
                
                this.popover.style.display = 'block';
                this.popover.style.left = `${left}px`;
                this.popover.style.top = `${top}px`;
            }
        }

        handleMouseOut(e) {
            const target = e.target;
            if (target.classList.contains('bcz-highlighted-word')) {
                this.popover.style.display = 'none';
            }
        }

        observeDOM() {
            if (this.observer) {
                this.observer.disconnect();
            }

            // 使用防抖处理 DOM 变化
            const debouncedHighlight = () => {
                if (this.highlightDebounceTimer) {
                    clearTimeout(this.highlightDebounceTimer);
                }
                this.highlightDebounceTimer = setTimeout(() => {
                    this.highlightWords();
                }, 500);
            };

            this.observer = new MutationObserver((mutations) => {
                let shouldHighlight = false;
                for (const mutation of mutations) {
                    if (mutation.addedNodes.length) {
                        shouldHighlight = true;
                        break;
                    }
                }
                if (shouldHighlight) {
                    debouncedHighlight();
                }
            });

            this.observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            // 监听滚动事件，处理新进入视图的内容
            window.addEventListener('scroll', () => {
                debouncedHighlight();
            }, { passive: true });
        }

        // 添加移除高亮的方法
        removeHighlights() {
            // 移除事件监听器
            document.removeEventListener('mouseover', this.handleMouseOver.bind(this));
            document.removeEventListener('mouseout', this.handleMouseOut.bind(this));

            const highlights = document.querySelectorAll('.bcz-highlighted-word');
            highlights.forEach(el => {
                const text = el.textContent;
                el.parentNode.replaceChild(document.createTextNode(text), el);
            });
            
            if (this.popover) {
                this.popover.remove();
                this.popover = null;
            }
            
            this.initialized = false;
            this.processedNodes = new WeakSet();
        }

        filterWords(words) {
            // 计算单词分数
            const scoredWords = words.map(word => ({
                ...word,
                score: this.calculateWordScore(word)
            }));

            // 按分数排序并选择前 MAX_HIGHLIGHT_WORDS 个单词
            return scoredWords
                .sort((a, b) => b.score - a.score)
                .slice(0, this.MAX_HIGHLIGHT_WORDS);
        }

        calculateWordScore(word) {
            const now = Date.now();
            const daysSinceCollected = (now - word.created_at) / (1000 * 60 * 60 * 24);
            
            // 计算分数的因素：
            // 1. 单词长度（较短的单词优先）
            const lengthScore = Math.max(0, 10 - word.word.length) / 10;
            
            // 2. 收藏时间（最近收藏的优先）
            const timeScore = Math.max(0, 30 - daysSinceCollected) / 30;
            
            // 3. 单词复杂度（基于是否包含特殊字符、连字符等）
            const complexityScore = this.getWordComplexityScore(word.word);
            
            // 4. 使用频率（如果有的话）
            const frequencyScore = word.frequency ? word.frequency / 100 : 0;

            // 权重配置
            const weights = {
                length: 0.2,
                time: 0.3,
                complexity: 0.2,
                frequency: 0.3
            };

            // 计算最终分数
            return (lengthScore * weights.length) +
                   (timeScore * weights.time) +
                   (complexityScore * weights.complexity) +
                   (frequencyScore * weights.frequency);
        }

        getWordComplexityScore(word) {
            // 简单词汇的特征
            const hasHyphen = word.includes('-');
            const hasSpecialChars = /[^a-zA-Z-]/.test(word);
            const isAllLowerCase = word === word.toLowerCase();
            const isShort = word.length <= 6;

            let score = 1;
            if (hasHyphen) score -= 0.2;
            if (hasSpecialChars) score -= 0.3;
            if (!isAllLowerCase) score -= 0.1;
            if (!isShort) score -= 0.2;

            return Math.max(0, score);
        }
    }

    // 初始化高亮器
    const highlighter = new ContentHighlighter();
    highlighter.init().catch(console.error);

})(window, document); 