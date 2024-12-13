;(function(window, $) {
    'use strict';

    // 确保在使用前初始化全局模块
    if (!window.__baicizhanHelperModule__) {
        window.__baicizhanHelperModule__ = {};
    }

    const {WordWebuiPopover, PhraseWebuiPopover, Toast, EnglishStemmer} = window.__baicizhanHelperModule__;
    const TRIGGER_MODE = {'SHOW_ICON': 'showIcon','DIRECT': 'direct','NEVER': 'never'};
    const POPOVER_STYLE = {'SIMPLE': 'simple', 'RICH': 'rich'};
    const THEME = {'LIGHT': 'light', 'DARK': 'dark', 'AUTO': 'auto'};
    const defaultTriggerMode = TRIGGER_MODE.SHOW_ICON; 
    const defaultPopoverStyle = POPOVER_STYLE.SIMPLE;
    const defaultTheme = THEME.LIGHT;    
    const stemmer = new EnglishStemmer();
    const $toastElement = new Toast();    
    let triggerMode, popoverStyle, theme, $popover, collectShortcutkey, popuped = false;

    const $supportElement = {
        init: function() {
            this.$el = $(`<div id="__baicizhanHelperSupportDiv__" style="position: absolute;"></div>`);
            this.$el.appendTo(document.body);
            this.$el.on('baicizhanHelper:alert', (e, message) => $toastElement.alert(message));
        },
        display: function() {
            this.$el.css('display', 'block');            
        },
        hide: function() {
            this.$el.css('display', 'none');
        },
        updatePosition() {
            try {
                let rect = window.getSelection().getRangeAt(0).getBoundingClientRect();
                this.$el.css('top',    rect.top + window.scrollY)
                        .css('left',   rect.left + window.scrollX)
                        .css('height', rect.height)
                        .css('width',  rect.width);
            } catch (error) {
                console.error('Error updating position:', error);
            }
        },
        createIconTips: function(onClick, onHide) {
            try {
                let iconSrc = `chrome-extension://${chrome.runtime.id}/icon.png`;
                this.$el.iconTips({
                    imgSrc: iconSrc,
                    onClick: () => {                    
                        this.destoryIconTips();
                        onClick();
                    },
                    onHide: () => {                    
                        this.destoryIconTips();
                        postpopup();
                        onHide();
                    }
                });
            } catch (error) {
                console.error('Error creating icon tips:', error);
            }
        },
        destoryIconTips: function() {
            try {
                this.$el.iconTips('destroy');
            } catch (error) {
                console.error('Error destroying icon tips:', error);
            }
        }
    };

    async function init() {
        try {
            await loadSetting();

            if (triggerMode == TRIGGER_MODE.NEVER) {
                return;
            }

            $toastElement.init();
            $supportElement.init();
            window.addEventListener('mouseup', selectWordHandler);
        } catch (error) {
            console.error('Error initializing:', error);
        }
    }

    async function loadSetting() {
        try {
            const response = await sendRequest({
                action: 'getStorageInfo',
                args: ['triggerMode', 'popoverStyle', 'theme', 'collectShortcutkey']
            });

            if (response) {
                const [_triggerMode, _popoverStyle, _theme, _collectShortcutkey] = response;
                triggerMode = _triggerMode || defaultTriggerMode;
                popoverStyle = _popoverStyle || defaultPopoverStyle;
                theme = _theme || defaultTheme;
                collectShortcutkey = _collectShortcutkey;

                if (theme == THEME.AUTO) {
                    let isSystemDarkTheme = window.matchMedia && 
                            window.matchMedia('(prefers-color-scheme: dark)').matches;
                    theme = isSystemDarkTheme ? THEME.DARK : THEME.LIGHT;
                }
            }
        } catch (error) {
            console.error('Error loading settings:', error);
            // 使用默认设置
            triggerMode = defaultTriggerMode;
            popoverStyle = defaultPopoverStyle;
            theme = defaultTheme;
        }
    }

    function selectWordHandler(e) {
        try {
            if (popuped) return;

            let selection = window.getSelection();
            let selectedText = selection.toString().trim();

            // 如果没有选中文本，隐藏支持元素
            if (!selectedText) {
                $supportElement.hide();
                return;
            }

            // 更新支持元素位置
            $supportElement.updatePosition();
            $supportElement.display();

            // 根据触发模式决定如何显示
            if (triggerMode == TRIGGER_MODE.DIRECT) {
                popup(selectedText);
            } else if (triggerMode == TRIGGER_MODE.SHOW_ICON) {
                // 不再判断文本长度，直接显示图标
                $supportElement.createIconTips(
                    () => popup(selectedText),
                    () => $supportElement.hide()
                );
            }
        } catch (error) {
            console.error('Error handling text selection:', error);
        }
    }

    function prepopup() {
        $supportElement.display();
        $supportElement.updatePosition();
    }

    function postpopup() {
        $supportElement.hide();
    }

    function canPopup() {
        if (triggerMode == TRIGGER_MODE.DIRECT) {
            postpopup();
            return Promise.resolve(true);
        }
        
        if (triggerMode == TRIGGER_MODE.NEVER) {  
            postpopup();  
            return Promise.resolve(false);
        }

        return new Promise(resolve => {
            $supportElement.createIconTips(
                // click
                () => resolve(true),
                // hide
                () => resolve(false)
            )
        });
    }    

    function popup(content) {
        // 销毁上一个 $popover
        $popover && $popover.destory();

        // 根据内容类型决定使用哪种弹出框
        if (isChineseWord(content) || isEnglishWord(content)) {
            popupWordWebuiPopover(content);
        } else {
            popupPhraseWebuiPopover(content);
        }        
    }

    function isChineseWord(str) {
        // 放宽对中文的限制
        return str.split('').every(char => /\p{Script=Han}/u.test(char));
    }

    function isEnglishWord(str) {
        // 只检查是否主要包含英文字符，不再限制长度
        let englishWordRegex = /^[a-zA-Z\\-\\s]+$/;
        return englishWordRegex.test(str);
    }

    function popupWordWebuiPopover(word) {
        sendRequest({action: 'getWordInfo', args: word}).then(response => {
            if (!response) return;

            $popover = new WordWebuiPopover({
                $el: $supportElement.$el,
                wordInfo: response.dict,
                popoverStyle,
                theme,
                collectShortcutkey,
                onHide: () => popuped = false
            });

            window.setTimeout(() => {
                popuped = true;
                $popover.show()
            }, 100);
        })
        .catch(e => {
            console.error(e);
            $supportElement.$el.css('display', 'none');
            $supportElement.$el.trigger('baicizhanHelper:alert', [e.message || '查询失败，稍后再试']);
        })
    }

    function popupPhraseWebuiPopover(phrase) {
        sendRequest({action: 'translate', args: phrase}).then(response => {
            if (!response) {
                throw new Error('翻译失败，返回结果为空');
            }

            $popover = new PhraseWebuiPopover({
                $el: $supportElement.$el,
                translation: response.translatedText,
                onHide: () => popuped = false
            });

            window.setTimeout(() => {
                popuped = true;
                $popover.show()
            }, 100);
        })
        .catch(e => {
            console.error('Translation error:', e);
            $supportElement.$el.css('display', 'none');
            $supportElement.$el.trigger('baicizhanHelper:alert', [
                e.message || '翻译服务暂时不可用，请稍后再试'
            ]);
        });
    }

    function sendRequest(option) {
        return new Promise((resolve, reject) => {
            try {
                chrome.runtime.sendMessage(option, (result) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    if (typeof result === 'string' && result.startsWith('[Error]:')) {
                        reject(new Error(result.substring(8)));
                        return;
                    }
                    resolve(result);
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    // 在页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})(window, jQuery); 