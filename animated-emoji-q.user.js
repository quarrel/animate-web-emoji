// ==UserScript==
// @name         Animate Emoji on the web --Q
// @namespace    Violentmonkey Scripts
// @version      2025-08-15_00-17
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

const DEBUG_MODE = true;

(async () => {
    const scriptStartTime = Date.now();

    let DotLottieWorker, DotLottie;
    try {
        ({ DotLottie, DotLottieWorker } = await import(
            'https://cdn.jsdelivr.net/npm/@lottiefiles/dotlottie-web@0.50.0/+esm'
        ));
    } catch (e) {
        if (DEBUG_MODE) {
            console.warn('dotlottie import failed; keeping text emojis', e);
        }
        return;
    }

    const EMOJI_DATA_URL =
        'https://googlefonts.github.io/noto-emoji-animation/data/api.json';
    const LOTTIE_URL_PATTERN =
        'https://fonts.gstatic.com/s/e/notoemoji/latest/{codepoint}/lottie.json';
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
    all: unset;              /* strip ALL inherited & UA styles */
    display: inline-block;   /* so width/height work */
    overflow: hidden;        /* keep canvas clipped if it overflows */
    line-height: 1;          /* avoid extra line spacing */
    vertical-align: -0.1em;  /* match emoji baseline alignment */
    }
    
    span.${UNIQUE_EMOJI_CLASS} > canvas {
    display: block;          /* prevent baseline spacing on canvas */
    object-fit: contain;
    image-rendering: crisp-edges;
    }
`);

    const getEmojiData = () => {
        return new Promise((resolve, reject) => {
            const cachedData = GM_getValue(EMOJI_DATA_CACHE_KEY, null);
            if (
                cachedData &&
                cachedData.timestamp > Date.now() - CACHE_EXPIRATION_MS
            ) {
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
                            timestamp: Date.now(),
                        };
                        GM_setValue(EMOJI_DATA_CACHE_KEY, dataToCache);
                        resolve(response.response);
                    } else {
                        reject('Failed to load emoji data');
                    }
                },
                onerror: reject,
            });
        });
    };

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
                        cachedLottie[codepoint] = {
                            data,
                            timestamp: Date.now(),
                        };
                        GM_setValue(LOTTIE_CACHE_KEY, cachedLottie);
                        resolve(data);
                    } else {
                        reject('Failed to load Lottie animation');
                    }
                },
                onerror: reject,
                onloadend: () => {
                    delete pendingLottieRequests[codepoint];
                },
            });
        });
        pendingLottieRequests[codepoint] = promise;
        return promise;
    };

    // === CONFIG ===
    const SCALE_FACTOR = 1.1; // Matches Emoiterra sizing
    const allDotLotties = new Set();

    const renderCfg = {
        //    devicePixelRatio: 0.75, // this should happen automatically in dottie
        freezeOnOffscreen: true,
        autoResize: true,
    };
    const layoutCfg = {
        fit: 'fill',
        align: [0.5, 0.5],
    };

    function createLazyEmojiSpan(emoji, animationData, referenceNode) {
        if (!animationData || typeof animationData !== 'object') {
            throw new Error('Invalid animation data');
        }

        const span = document.createElement('span');
        span.className = UNIQUE_EMOJI_CLASS;
        span.dataset.emoji = emoji;
        span.title = `${emoji} (emoji u${emoji.codePointAt(0).toString(16)})`;

        // Dynamically size to match replaced emoji
        let fontSizePx = 16;
        if (referenceNode && referenceNode.parentNode) {
            fontSizePx = parseFloat(
                getComputedStyle(referenceNode.parentNode).fontSize
            );
        }
        const scale = SCALE_FACTOR; // tweak for visual match
        span.style.width = fontSizePx * scale + 'px';
        span.style.height = fontSizePx * scale + 'px';

        const canvas = document.createElement('canvas');
        canvas.width = fontSizePx * scale;
        canvas.height = fontSizePx * scale;
        canvas.style.width = fontSizePx * scale + 'px';
        canvas.style.height = fontSizePx * scale + 'px';

        span.appendChild(canvas);

        // Lazy load animation when visible
        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    let player = span.dotLottiePlayer;
                    if (!player) {
                        player = new DotLottie({
                            canvas,
                            data: animationData,
                            loop: true,
                            autoplay: true,
                            renderConfig: renderCfg,
                            layout: layoutCfg,
                        });
                        span.dotLottiePlayer = player;
                        allDotLotties.add(player);
                    }
                    player.play();
                } else {
                    if (span.dotLottiePlayer) {
                        span.dotLottiePlayer.pause();
                    }
                }
            }
        });
        observer.observe(span);

        return span;
    }

    // Pause/play all animations when tab visibility changes
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            allDotLotties.forEach((p) => p.pause());
        } else {
            allDotLotties.forEach((p) => p.play());
        }
    });

    // === MAIN REPLACEMENT ===
    async function replaceEmojiInTextNode(node) {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        const replacements = [];

        //console.log('Current node: ' + walker.currentNode.nodeValue);
        while (walker.nextNode()) {
            const textNode = walker.currentNode;
            const text = textNode.nodeValue;
            if (!text) continue;

            const matches = [...text.matchAll(emojiRegex)];
            const emojisToProcess = matches
                .map((match) => {
                    const emojiStr = match[0];
                    const codepoint = emojiToCodepoint.get(emojiStr);
                    if (codepoint) {
                        if (DEBUG_MODE) {
                            console.log(emojiStr, codepoint);
                        }
                    }
                    return codepoint ? { match, codepoint } : null;
                })
                .filter(Boolean);

            if (emojisToProcess.length === 0) continue;
            const promises = emojisToProcess.map((emoji) =>
                getLottieAnimationData(emoji.codepoint)
            );
            // needs to be improved, we should be processing the finished ones
            const results = await Promise.allSettled(promises);

            const frag = document.createDocumentFragment();
            let lastIndex = 0;

            emojisToProcess.forEach((emoji, i) => {
                const { match } = emoji;
                const result = results[i];

                if (match.index > lastIndex) {
                    frag.appendChild(
                        document.createTextNode(
                            text.slice(lastIndex, match.index)
                        )
                    );
                }
                if (result.status === 'fulfilled') {
                    frag.appendChild(
                        createLazyEmojiSpan(match[0], result.value, textNode)
                    );
                } else {
                    frag.appendChild(document.createTextNode(match[0])); // fallback
                }
                lastIndex = match.index + match[0].length;
            });

            if (lastIndex < text.length) {
                frag.appendChild(
                    document.createTextNode(text.slice(lastIndex))
                );
            }

            replacements.push({ textNode, frag });
        }
        if (DEBUG_MODE) {
            console.log('processing all replacements = ' + replacements.length);
        }
        // Apply all replacements in one pass
        for (const { textNode, frag } of replacements) {
            // Determine replacement target
            const parent = textNode.parentNode;
            if (!parent) {
                if (DEBUG_MODE) {
                    console.error(
                        'No parent node for text node, I do not think this should happen. Node: ' +
                            textNode.nodeValue
                    );
                }
                continue;
            }

            // CASE: parent is a "bare" span containing only this text node
            if (
                parent.tagName === 'SPAN' &&
                parent.childNodes.length === 1 &&
                frag.childElementCount === 1
            ) {
                const newEmojiEl = frag.firstChild;

                // Preserve original attributes (like title, aria-label)
                for (const attr of Array.from(parent.attributes)) {
                    if (!newEmojiEl.hasAttribute(attr.name)) {
                        newEmojiEl.setAttribute(attr.name, attr.value);
                    }
                }

                // Swap parent span with our emoji span
                parent.replaceWith(newEmojiEl);
            } else {
                textNode.parentNode.replaceChild(frag, textNode);
            }
        }
    }

    const processAddedNode = async (node) => {
        if (!document.body || !document.body.contains(node)) return;
        replaceEmojiInTextNode(node);
        return;
        if (node.nodeType === Node.TEXT_NODE) {
            if (DEBUG_MODE) {
                console.log('first type');
            }
            replaceEmojiInTextNode(node);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const SKIP = new Set([
                'SCRIPT',
                'STYLE',
                'NOSCRIPT',
                'TEXTAREA',
                'INPUT',
                'CODE',
                'PRE',
                'SVG',
                'CANVAS',
            ]);
            const walker = document.createTreeWalker(
                node,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode(node) {
                        const parent = node.parentNode;
                        if (!parent) return NodeFilter.FILTER_REJECT;
                        if (SKIP.has(parent.nodeName))
                            return NodeFilter.FILTER_REJECT;
                        if (
                            parent.closest(
                                '[contenteditable=""], [contenteditable="true"]'
                            )
                        )
                            return NodeFilter.FILTER_REJECT;
                        if (parent.closest('.' + UNIQUE_EMOJI_CLASS))
                            return NodeFilter.FILTER_REJECT;
                        if (!node.nodeValue || !node.nodeValue.trim())
                            return NodeFilter.FILTER_REJECT;
                        return NodeFilter.FILTER_ACCEPT;
                    },
                }
            );
            while (walker.nextNode())
                replaceEmojiInTextNode(walker.currentNode);
        }
    };

    let observerCount = 0;
    let debouncedNodes = new Set();
    let debouncedTimeout = null;

    const getNodesFromMutations = (mutationsList) => {
        const nodes = new Set();
        for (const mutation of mutationsList) {
            if (
                mutation.type === 'childList' &&
                mutation.addedNodes.length > 0
            ) {
                nodes.add(mutation.target);
            } else if (
                ['characterData', 'attributes'].includes(mutation.type)
            ) {
                nodes.add(mutation.target);
            }
        }
        return nodes;
    };

    const observer = new MutationObserver((mutationsList) => {
        observerCount++;
        const newNodes = new Set();
        for (const mutation of mutationsList) {
            if (
                mutation.type === 'childList' &&
                mutation.addedNodes.length > 0
            ) {
                mutation.addedNodes.forEach(node => newNodes.add(node));
            } else if (
                ['characterData', 'attributes'].includes(mutation.type)
            ) {
                newNodes.add(mutation.target);
            }

            // Handle removed nodes
            if (mutation.type === 'childList' && mutation.removedNodes.length > 0) {
                mutation.removedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains(UNIQUE_EMOJI_CLASS)) {
                        if (node.dotLottiePlayer) {
                            node.dotLottiePlayer.destroy(); // Assuming DotLottie has a destroy method
                            allDotLotties.delete(node.dotLottiePlayer);
                            delete node.dotLottiePlayer; // Clean up reference
                        }
                    }
                });
            }
        }

        if (observerCount <= DEBOUNCE_THRESHOLD) {
            newNodes.forEach(processAddedNode);
            return;
        }
        if (debouncedTimeout) clearTimeout(debouncedTimeout);
        newNodes.forEach((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) {
                debouncedNodes.add(node);
                return;
            }
            for (const existing of debouncedNodes) {
                if (
                    existing.nodeType === Node.ELEMENT_NODE &&
                    existing.contains(node)
                )
                    return;
            }
            for (const existing of [...debouncedNodes]) {
                if (
                    existing.nodeType === Node.ELEMENT_NODE &&
                    node.contains(existing)
                ) {
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

    const main = async () => {
        try {
            // Start both fetches in parallel
            const emojiDataPromise = getEmojiData();
            const lottieCachePromise = new Promise((resolve) =>
                resolve(GM_getValue(LOTTIE_CACHE_KEY, {}))
            );

            // Process Lottie cache as soon as it's ready
            lottieCachePromise.then((storedLottieCache) => {
                cachedLottie = storedLottieCache;
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
                if (DEBUG_MODE) {
                    console.log(
                        'Lottie cache loaded ' +
                            (Date.now() - scriptStartTime) +
                            'ms'
                    );
                }
            });

            // Process emoji data when it's ready
            emojiDataPromise.then((emojiData) => {
                for (const icon of emojiData.icons) {
                    const chars = icon.codepoint
                        .split('_')
                        .map((hex) => String.fromCodePoint(parseInt(hex, 16)))
                        .join('');
                    emojiToCodepoint.set(chars, icon.codepoint);
                    emojiNameMap[chars] = icon.name.replace(/_/g, ' ');
                }
                if (DEBUG_MODE) {
                    console.log(
                        'Emoji cache loaded ' +
                            (Date.now() - scriptStartTime) +
                            'ms'
                    );
                }
            });

            // Wait for both to complete before starting the observer
            await Promise.all([emojiDataPromise, lottieCachePromise]);

            if (DEBUG_MODE) {
                console.log(
                    'Script startup time: ' + (Date.now() - scriptStartTime) + 'ms'
                );
            }

            observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: false,
            });
            if (document.body) {
                processAddedNode(document.body);
            }
        } catch (error) {
            if (DEBUG_MODE) {
                console.error(
                    'Failed to initialize emoji animation script:',
                    error
                );
            }
        }
    };

    main();
})();
