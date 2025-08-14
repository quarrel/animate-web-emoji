// ==UserScript==
// @name         Animate Emoji on the web --Q
// @namespace    Violentmonkey Scripts
// @version      2025-08-14_19-33
// @description  Animate emoji on the web using the noto animated emoji from Google.
// @author       Quarrel
// @homepage     https://github.com/quarrel/animate-web-emoji
// @match        *://*/*
// @run-at       document-start
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @license      MIT
// @downloadURL  https://greasyfork.org/en/scripts/945524-animate-web-emoji-q
// ==/UserScript==

'use strict';

(async () => {
    let DotLottieWorker, DotLottie;
    try {
        ({ DotLottie, DotLottieWorker } = await import('https://cdn.jsdelivr.net/npm/@lottiefiles/dotlottie-web@0.50.0/+esm'));
    } catch (e) {
        console.warn('dotlottie import failed; keeping text emojis', e);
        return;
    }

    const EMOJI_DATA_URL = 'https://googlefonts.github.io/noto-emoji-animation/data/api.json';
    const LOTTIE_URL_PATTERN = 'https://fonts.gstatic.com/s/e/notoemoji/latest/{codepoint}/lottie.json';
    const UNIQUE_EMOJI_CLASS = 'Q93EMOJIQ';
    const EMOJI_DATA_CACHE_KEY = 'Q_noto_emoji_data_cache';
    const LOTTIE_CACHE_KEY = 'Q_noto_lottie_cache';
    const CACHE_EXPIRATION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
    const DEBOUNCE_DELAY_MS = 10;
    const DEBOUNCE_THRESHOLD = 25;
    const emojiRegex = /\p{RGI_Emoji}/gv; 

    let lottieCache = {};
    let cachedLottie = {};
    let pendingLottieRequests = {};
    let emojiNameMap = {};
    const emojiToCodepoint = new Map();

GM_addStyle(`
    span.${UNIQUE_EMOJI_CLASS} {
        all: initial;
        display: inline-block;
        width: 1em;
        height: 1em;
        vertical-align: -0.1em;
        margin: 0 0.05em;
        line-height: 1;
        font-size: inherit;
        overflow: visible;
        position: relative;
        will-change: transform;
    }
    span.${UNIQUE_EMOJI_CLASS} > canvas {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: contain;
        image-rendering: crisp-edges;
    }
    span.${UNIQUE_EMOJI_CLASS}:hover {
        transform: scale(1.12);
        transition: transform 0.15s ease;
    }
    span.${UNIQUE_EMOJI_CLASS}:active {
        transform: scale(0.95);
    }
`);

//debugging box
/*
GM_addStyle(`
    span.${UNIQUE_EMOJI_CLASS} > canvas {
    border: 1px solid rgba(255,0,0,0.3);
}
`);
    span.tmpClass {
    width: 1em;
    height: 1em;
    overflow: hidden;
    position: relative;
    will-change: transform;
    display: contents;
    border: 0px, none;
    padding: 0px;
    }
    span.tmpClass > canvas {
        width: 1em;
        height: 1em;
        display: block;
        overflow: visible;
        object-fit: scale-down;
        transform-origin: center
        transform: translateZ(0)
        border: 0px, none;
        padding: 0px;
    }
*/

    /**
     * Fetch emoji metadata (list of animated emojis)
     */
    const getEmojiData = () => {
        return new Promise((resolve, reject) => {
            const cachedData = GM_getValue(EMOJI_DATA_CACHE_KEY, null);
            if (cachedData && cachedData.timestamp > Date.now() - CACHE_EXPIRATION_MS) {
                resolve(cachedData.data);
                return;
            }

            GM_xmlhttpRequest({
                method: 'GET',
                url: EMOJI_DATA_URL,
                responseType: 'json',
                onload: (response) => {
                    if (response.status === 200) {
                        const dataToCache = {
                            data: response.response,
                            timestamp: Date.now()
                        };
                        GM_setValue(EMOJI_DATA_CACHE_KEY, dataToCache);
                        resolve(response.response);
                    } else {
                        reject('Failed to load emoji data');
                    }
                },
                onerror: reject
            });
        });
    };

    /**
     * Fetch Lottie animation for a codepoint (cached + deduplicated)
     */
    const getLottieAnimationData = (codepoint) => {
        if (lottieCache[codepoint]) {
            return Promise.resolve(lottieCache[codepoint]);
        }

        if (pendingLottieRequests[codepoint]) {
            return pendingLottieRequests[codepoint];
        }

        const promise = new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: LOTTIE_URL_PATTERN.replace('{codepoint}', codepoint),
                responseType: 'json',
                onload: (response) => {
                    if (response.status === 200) {
                        const data = response.response;
                        lottieCache[codepoint] = data;
                        cachedLottie[codepoint] = { data, timestamp: Date.now() };
                        GM_setValue(LOTTIE_CACHE_KEY, cachedLottie);
                        resolve(data);
                    } else {
                        reject('Failed to load Lottie animation');
                    }
                },
                onerror: reject,
                onloadend: () => {
                    delete pendingLottieRequests[codepoint];
                }
            });
        });

        pendingLottieRequests[codepoint] = promise;
        return promise;
    };

    const renderCfg = {
    //    devicePixelRatio: 0.75,
        freezeOnOffscreen: true,
        autoResize: true
    };
    const layoutCfg = {
        fit: "contain",
        align: [0.5,0.5]
    }

function createLazyEmojiSpan(emojiChar, animationData, codepoint) {

    if (!animationData || typeof animationData !== 'object') { throw new Error('Invalid animation data'); }
    let canvas = null;

    const span = document.createElement('span');
    span.className = UNIQUE_EMOJI_CLASS;
    span.dataset.emoji = emojiChar;
    span.dataset.codepoint = codepoint;
    span.title = emojiNameMap[emojiChar] ? `${emojiChar} (${emojiNameMap[emojiChar]})` : emojiChar;
    //span.textContent = emojiChar;

    canvas = document.createElement('canvas');
    span.appendChild(canvas);
    const renderCfg = {
    //    devicePixelRatio: 0.75,
        freezeOnOffscreen: true,
        autoResize: true
    };

    const layoutCfg = {
        fit: "fill",
        align: [0.5,0.5]
    }
    const dotLottie = new DotLottie({
        canvas,
        data: animationData,
        loop: true,
        autoplay: true,
        renderConfig: renderCfg,
        layout: layoutCfg
    });

    //console.log("Animating " + emojiChar + " with " + animationData);

    return span;
}

    /**
     * Replace emoji in a text node
     */
    const replaceEmojiInTextNode = async (textNode) => {
        const text = textNode.nodeValue;
        if (!text) return;

        const matches = [...text.matchAll(emojiRegex)];
        const emojisToProcess = matches
            .map(match => {
                const emojiStr = match[0];
                const codepoint = emojiToCodepoint.get(emojiStr);
                if (codepoint) {
                    //console.log(emojiStr, codepoint);
                }
                return codepoint ? { match, codepoint } : null;
            })
            .filter(Boolean);

        if (emojisToProcess.length === 0) return;

        const promises = emojisToProcess.map(emoji => getLottieAnimationData(emoji.codepoint));
        // needs to be improved, we should be processing the finished ones
        const results = await Promise.allSettled(promises);

        console.log(emojisToProcess.length + ' emoji: ' + text);
    
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;

        emojisToProcess.forEach((emoji, i) => {
            const { match } = emoji;
            const result = results[i];

            if (match.index > lastIndex) {
                fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
            }

            if (result.status === 'fulfilled') {
                //console.log("Getting " + match[0] + result.value);
                fragment.appendChild(createLazyEmojiSpan(match[0], result.value, emoji.codepoint));
            } else {
                fragment.appendChild(document.createTextNode(match[0])); // fallback
            }

            lastIndex = match.index + match[0].length;
        });

        if (lastIndex < text.length) {
            fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
        }

        if (fragment.hasChildNodes()) {
            textNode.parentNode.replaceChild(fragment, textNode);
        }
    };

    /**
     * Process a newly added node (text or element)
     */
    const processAddedNode = async (node) => {
        if (!document.body || !document.body.contains(node)) return;

        if (node.nodeType === Node.TEXT_NODE) {
            replaceEmojiInTextNode(node);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const SKIP = new Set([
                'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT',
                'CODE', 'PRE', 'SVG', 'CANVAS'
            ]);

            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                    const parent = node.parentNode;
                    if (!parent) return NodeFilter.FILTER_REJECT;
                    if (SKIP.has(parent.nodeName)) return NodeFilter.FILTER_REJECT;
                    if (parent.closest('[contenteditable=""], [contenteditable="true"]')) return NodeFilter.FILTER_REJECT;
                    if (parent.closest('.' + UNIQUE_EMOJI_CLASS)) return NodeFilter.FILTER_REJECT;
                    if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                }
            });

            // why pause here? Just process the text nodes as they're found.
            while (walker.nextNode())
                replaceEmojiInTextNode(walker.currentNode);
            /*
            const nodes = [];
            while (walker.nextNode()) nodes.push(walker.currentNode);
            await Promise.all(nodes.map(replaceEmojiInTextNode));
            */
        }
    };

    /**
     * Mutation observer with debounce
     */
    let observerCount = 0;
    let debouncedNodes = new Set();
    let debouncedTimeout = null;

    const getNodesFromMutations = (mutationsList) => {
        const nodes = new Set();
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                nodes.add(mutation.target);
            } else if (['characterData', 'attributes'].includes(mutation.type)) {
                nodes.add(mutation.target);
            }
        }
        return nodes;
    };

    const observer = new MutationObserver((mutationsList) => {
        observerCount++;
        const newNodes = getNodesFromMutations(mutationsList);

        if (observerCount <= DEBOUNCE_THRESHOLD) {
            newNodes.forEach(processAddedNode);
            return;
        }

        if (debouncedTimeout) clearTimeout(debouncedTimeout);

        newNodes.forEach(node => {
            if (node.nodeType !== Node.ELEMENT_NODE) {
                debouncedNodes.add(node);
                return;
            }

            // Skip if this node contains an already scheduled node
            for (const existing of debouncedNodes) {
                if (existing.nodeType === Node.ELEMENT_NODE && existing.contains(node)) {
                    return;
                }
            }

            // Remove any nodes that are inside this one
            for (const existing of debouncedNodes) {
                if (existing.nodeType === Node.ELEMENT_NODE && node.contains(existing)) {
                    debouncedNodes.delete(existing);
                }
            }

            debouncedNodes.add(node);
        });

        debouncedTimeout = setTimeout(() => {
            debouncedNodes.forEach(processAddedNode);
            debouncedNodes.clear();
            debouncedTimeout = null;
        }, DEBOUNCE_DELAY_MS);
    });

    /**
     * Main initialization
     */
    const main = async () => {
        // Clear cache
        //GM_setValue(LOTTIE_CACHE_KEY, null);
        //GM_setValue(EMOJI_DATA_CACHE_KEY, null);

        try {
            const [emojiData, storedLottieCache] = await Promise.all([
                getEmojiData(),
                GM_getValue(LOTTIE_CACHE_KEY, {})
            ]);

            cachedLottie = storedLottieCache;

            // Build emoji map
            for (const icon of emojiData.icons) {
                const chars = icon.codepoint.split('_')
                    .map(hex => String.fromCodePoint(parseInt(hex, 16)))
                    .join('');
                //console.log(icon.name + " " + chars + " " + icon.codepoint);
                emojiToCodepoint.set(chars, icon.codepoint);
                emojiNameMap[chars] = icon.name.replace(/_/g, ' ');

            }

            // Restore valid lottie cache
            let cacheNeedsUpdate = false;
            for (const codepoint in cachedLottie) {
                const entry = cachedLottie[codepoint];
                if (entry.timestamp > Date.now() - CACHE_EXPIRATION_MS) {
                    lottieCache[codepoint] = entry.data;
                } else {
                    delete cachedLottie[codepoint];
                    cacheNeedsUpdate = true;
                }
            }
            if (cacheNeedsUpdate) {
                GM_setValue(LOTTIE_CACHE_KEY, cachedLottie);
            }

            // Observe future changes
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: false
            });

            if (document.body) {
                processAddedNode(document.body);
            }

        } catch (error) {
            console.error('Failed to initialize emoji animation script:', error);
        }
    };

    main();

})();
