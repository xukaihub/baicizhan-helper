;(function(window) {
    'use strict';

    const {EnglishStemmer} = window.__baicizhanHelperModule__;
    const stemmer = new EnglishStemmer();

    /**
     * calculate levenshtein edit distance
     * 
     * @see https://stackoverflow.com/questions/18516942/fastest-general-purpose-levenshtein-javascript-implementation
     */
    function levenshtein(s, t) {
        if (s === t) {
            return 0;
        }
        var n = s.length, m = t.length;
        if (n === 0 || m === 0) {
            return n + m;
        }
        var x = 0, y, a, b, c, d, g, h;
        var p = new Uint16Array(n);
        var u = new Uint32Array(n);
        for (y = 0; y < n;) {
            u[y] = s.charCodeAt(y);
            p[y] = ++y;
        }

        for (; (x + 3) < m; x += 4) {
            var e1 = t.charCodeAt(x);
            var e2 = t.charCodeAt(x + 1);
            var e3 = t.charCodeAt(x + 2);
            var e4 = t.charCodeAt(x + 3);
            c = x;
            b = x + 1;
            d = x + 2;
            g = x + 3;
            h = x + 4;
            for (y = 0; y < n; y++) {
                a = p[y];
                if (a < c || b < c) {
                    c = (a > b ? b + 1 : a + 1);
                }
                else {
                    if (e1 !== u[y]) {
                        c++;
                    }
                }

                if (c < b || d < b) {
                    b = (c > d ? d + 1 : c + 1);
                }
                else {
                    if (e2 !== u[y]) {
                        b++;
                    }
                }

                if (b < d || g < d) {
                    d = (b > g ? g + 1 : b + 1);
                }
                else {
                    if (e3 !== u[y]) {
                        d++;
                    }
                }

                if (d < g || h < g) {
                    g = (d > h ? h + 1 : d + 1);
                }
                else {
                    if (e4 !== u[y]) {
                        g++;
                    }
                }
                p[y] = h = g;
                g = d;
                d = b;
                b = c;
                c = a;
            }
        }

        for (; x < m;) {
            var e = t.charCodeAt(x);
            c = x;
            d = ++x;
            for (y = 0; y < n; y++) {
                a = p[y];
                if (a < c || d < c) {
                    d = (a > d ? d + 1 : a + 1);
                }
                else {
                    if (e !== u[y]) {
                        d = c + 1;
                    }
                    else {
                        d = c;
                    }
                }
                p[y] = d;
                c = a;
            }
            h = d;
        }

        return h;
    }

    function getHighlightWord(sentence, word) {
        return sentence.split(/\s/)
            .map(s => {
                let regex = /[\w-]+/;

                if (regex.test(s)) {
                    let term = s.match(regex)[0];
                    let distance = Math.min(
                        levenshtein(term, word), 
                        levenshtein(term, stemmer.stemWord(word)), 
                        levenshtein(stemmer.stemWord(term), word), 
                        levenshtein(stemmer.stemWord(term), stemmer.stemWord(word)));
                    let highlightable = term.length < 7 ? distance <= 3 : distance <= 5;

                    if (highlightable) {
                        return [distance, term];
                    }
                }

                return null;
            })
            .filter(pair => pair !== null)
            .reduce((a, b) => a[0] < b[0] ? a : b, [Number.MAX_SAFE_INTEGER, '']);
    }

    function highlightSentence(sentence, word) {
        if (sentence.highlight_phrase) {
            return sentence.sentence.replace(
                sentence.highlight_phrase,
                `<span style="color: #007bff;">${sentence.highlight_phrase}</span>`
            );
        }

        let highlightWord = getHighlightWord(sentence.sentence, word);

        if (!highlightWord) {
            return sentence.sentence;
        }

        let replaceRegex = new RegExp(`\\b${highlightWord[1]}\\b`, 'g');

        return sentence.sentence.replace(replaceRegex, (match) => {
            return `<span style="color: #007bff;">${match}</span>`;
        });
    }

    if (!window.utilModule) {
        window.utilModule = {levenshtein, getHighlightWord, highlightSentence};
    }

    if (!window.__baicizhanHelperModule__) {
        window.__baicizhanHelperModule__ = {};
    }

    window.__baicizhanHelperModule__.levenshtein = levenshtein;
    window.__baicizhanHelperModule__.getHighlightWord = getHighlightWord;
    window.__baicizhanHelperModule__.highlightSentence = highlightSentence;
} (this));