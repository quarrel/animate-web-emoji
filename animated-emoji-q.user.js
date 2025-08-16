// ==UserScript==
// @name         Animate Emoji on the web --Q
// @namespace    Violentmonkey Scripts
// @version      2025-08-16_23-08
// @description  Animate emoji on the web using the noto animated emoji from Google.
// @author       Quarrel
// @homepage     https://github.com/quarrel/animate-web-emoji
// @match        *://*/*
// @run-at       document-start
// @noframes
// @require      https://cdn.jsdelivr.net/gh/quarrel/dotlottie-web-standalone@7594952f537e155b66c2c4ae59dcb0bda0635f52/build/dotlottie-web-iife.js
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @license      MIT
// @downloadURL  https://greasyfork.org/en/scripts/546062-animate-emoji-on-the-web-q
// ==/UserScript==

'use strict';

const DEBUG_MODE = false;

(async () => {
    const scriptStartTime = Date.now();

    const WASMPLAYERURL =
        'https://cdn.jsdelivr.net/npm/@lottiefiles/dotlottie-web@0.50.0/dist/dotlottie-player.wasm';
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
    const DEBOUNCE_SAVE_DELAY_MS = 5000;
    const emojiRegex = /\p{RGI_Emoji}/gv;

    let requestQueue = [];
    let activeRequests = 0;
    const MAX_CONCURRENT_REQUESTS = 8;

    let lottieCache = {};
    let cachedLottie = {};
    let pendingLottieRequests = {};
    let emojiNameMap = {};
    const emojiToCodepoint = new Map();

    function base64ToBytes(base64) {
        const binString = atob(base64);
        return Uint8Array.from(binString, (char) => char.charCodeAt(0));
    }

    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    const loadWasm = (url) => {
        return new Promise(async (resolve, reject) => {
            const CACHE_KEY = `wasm_cache_${url}`;
            const CACHE_TTL = 24 * 60 * 60 * 1000; // 1 day
            const NOW = Date.now();

            const cached = await GM_getValue(CACHE_KEY, null);

            if (cached && cached.code && cached.timestamp > NOW - CACHE_TTL) {
                if (DEBUG_MODE) {
                    console.log('Loading WASM from cache:', url);
                }
                try {
                    const bytes = base64ToBytes(cached.code);
                    return resolve(bytes.buffer); // resolve as ArrayBuffer
                } catch (e) {
                    console.warn('Cache decode failed, re-fetching:', e);
                }
            }

            // Cache miss — fetch fresh
            if (DEBUG_MODE) {
                console.log('Fetching WASM:', url);
            }

            GM_xmlhttpRequest({
                method: 'GET',
                url,
                responseType: 'arraybuffer',
                onload: async (res) => {
                    if (res.status !== 200 || !res.response) {
                        return reject(new Error(`HTTP ${res.status}`));
                    }

                    const arrayBuffer = res.response;

                    try {
                        const base64 = arrayBufferToBase64(arrayBuffer);
                        await GM_setValue(CACHE_KEY, {
                            code: base64,
                            timestamp: NOW,
                        });
                    } catch (e) {
                        console.warn('Failed to cache WASM:', e);
                        // Continue anyway
                    }

                    resolve(arrayBuffer);
                },
                onerror: (err) => {
                    console.error('GM_xmlhttpRequest failed:', err);
                    reject(err);
                },
            });
        });
    };

    function patchFetchPlayer(bin) {
        const origFetch = window.fetch;
        window.fetch = new Proxy(origFetch, {
            apply(target, thisArg, args) {
                const [url] = args;
                if (
                    typeof url === 'string' &&
                    url.endsWith('dotlottie-player.wasm')
                ) {
                    return Promise.resolve(
                        new Response(bin, {
                            status: 200,
                            headers: { 'Content-Type': 'application/wasm' },
                        })
                    );
                }
                return Reflect.apply(target, thisArg, args);
            },
        });
    }

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

    let isCacheDirty = false;
    const saveLottieCache = () => {
        if (isCacheDirty) {
            if (DEBUG_MODE) {
                console.log(
                    'Cache is dirty, saving to storage on page hide/visibility change...'
                );
            }
            GM_setValue(LOTTIE_CACHE_KEY, cachedLottie);
            isCacheDirty = false;
        }
    };
    document.addEventListener('visibilitychange', saveLottieCache);
    document.addEventListener('pagehide', saveLottieCache);

    function processRequestQueue() {
        if (
            requestQueue.length === 0 ||
            activeRequests >= MAX_CONCURRENT_REQUESTS
        ) {
            return;
        }

        activeRequests++;
        const { codepoint, resolve, reject } = requestQueue.shift();

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
                    isCacheDirty = true;
                    resolve(data);
                } else {
                    reject('Failed to load Lottie animation');
                }
            },
            onerror: reject,
            onloadend: () => {
                delete pendingLottieRequests[codepoint];
                activeRequests--;
                processRequestQueue();
            },
        });
    }

    const getLottieAnimationData = (codepoint) => {
        if (lottieCache[codepoint]) {
            return Promise.resolve(lottieCache[codepoint]);
        }
        if (pendingLottieRequests[codepoint]) {
            return pendingLottieRequests[codepoint];
        }

        const promise = new Promise((resolve, reject) => {
            requestQueue.push({ codepoint, resolve, reject });
            processRequestQueue();
        });

        pendingLottieRequests[codepoint] = promise;
        return promise;
    };

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

    const sharedIO = new IntersectionObserver(
        async (entries) => {
            for (const entry of entries) {
                const span = entry.target;
                if (entry.isIntersecting) {
                    let player = span.dotLottiePlayer;
                    if (!player) {
                        getLottieAnimationData(span.dataset.codepoint).then(
                            (animationData) => {
                                // Clear the text placeholder before adding the canvas
                                span.textContent = '';

                                const canvas = document.createElement('canvas');
                                let size = Number(
                                    span.style.width.replace('px', '')
                                );
                                canvas.width = size;
                                canvas.height = size;
                                canvas.style.width = size + 'px';
                                canvas.style.height = size + 'px';
                                span.appendChild(canvas);
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
                        );
                    }
                    if (player) player.play();
                } else {
                    if (span.dotLottiePlayer) {
                        span.dotLottiePlayer.pause();
                    }
                }
            }
        },
        { rootMargin: '100px' }
    );

    function createLazyEmojiSpan(emoji, referenceNode) {
        const span = document.createElement('span');
        span.className = UNIQUE_EMOJI_CLASS;
        span.dataset.emoji = emoji;
        span.dataset.codepoint = emojiToCodepoint.get(emoji);
        span.title = `${emoji} (emoji u${emoji.codePointAt(0).toString(16)})`;

        // Dynamically size to match replaced emoji
        let fontSizePx = 16;
        let parentStyle;
        if (referenceNode && referenceNode.parentNode) {
            parentStyle = getComputedStyle(referenceNode.parentNode);
            fontSizePx = parseFloat(parentStyle.fontSize);
        }
        const scale = SCALE_FACTOR; // tweak for visual match
        const finalSize = fontSizePx * scale;
        span.style.width = finalSize + 'px';
        span.style.height = finalSize + 'px';

        // Use the original emoji as a placeholder
        span.textContent = emoji;
        // Style the placeholder to be centered and sized correctly
        if (parentStyle) {
            span.style.fontSize = parentStyle.fontSize;
        }
        span.style.lineHeight = finalSize + 'px';
        span.style.textAlign = 'center';

        sharedIO.observe(span);

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

    async function replaceEmojiInTextNode(node) {
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

        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
            acceptNode(textNode) {
                // Reject nodes based on their parent's properties
                const parent = textNode.parentNode;
                if (!parent) return NodeFilter.FILTER_REJECT;

                if (SKIP.has(parent.nodeName)) {
                    return NodeFilter.FILTER_REJECT;
                }
                if (
                    parent.closest(
                        '[contenteditable=""], [contenteditable="true"]'
                    )
                ) {
                    return NodeFilter.FILTER_REJECT;
                }
                if (parent.closest('.' + UNIQUE_EMOJI_CLASS)) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            },
        });

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

            const frag = document.createDocumentFragment();
            let lastIndex = 0;

            emojisToProcess.forEach((emoji, i) => {
                const { match } = emoji;
                //const result = results[i];
                const animPromise = promises[i];

                if (match.index > lastIndex) {
                    frag.appendChild(
                        document.createTextNode(
                            text.slice(lastIndex, match.index)
                        )
                    );
                }

                frag.appendChild(createLazyEmojiSpan(match[0], textNode));
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

            // move a single new span, in a span, up a level, with the correct styling.
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
    };

    let observerCount = 0;
    let debouncedNodes = new Set();
    let debouncedTimeout = null;

    function processDebouncedNodes() {
        if (debouncedNodes.size === 0) {
            debouncedTimeout = null;
            return;
        }
        const node = debouncedNodes.values().next().value;
        debouncedNodes.delete(node);

        processAddedNode(node);

        // Re-schedule the processing for the next node in the queue - timeslice it
        debouncedTimeout = setTimeout(processDebouncedNodes, 0);
    }

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
                mutation.addedNodes.forEach((node) => newNodes.add(node));
            } else if (
                ['characterData', 'attributes'].includes(mutation.type)
            ) {
                newNodes.add(mutation.target);
            }

            // Handle removed nodes
            if (
                mutation.type === 'childList' &&
                mutation.removedNodes.length > 0
            ) {
                mutation.removedNodes.forEach((node) => {
                    if (
                        node.nodeType === Node.ELEMENT_NODE &&
                        node.classList.contains(UNIQUE_EMOJI_CLASS)
                    ) {
                        if (node.dotLottiePlayer) {
                            node.dotLottiePlayer.destroy();
                            allDotLotties.delete(node.dotLottiePlayer);
                            delete node.dotLottiePlayer;
                        }
                    }
                });
            }
        }

        if (observerCount <= DEBOUNCE_THRESHOLD) {
            newNodes.forEach(processAddedNode);
            return;
        }

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

        if (debouncedTimeout) return;

        debouncedTimeout = setTimeout(processDebouncedNodes, DEBOUNCE_DELAY_MS);
    });

    const main = async () => {
        try {
            loadWasm(WASMPLAYERURL).then((bin) => {
                patchFetchPlayer(bin);
                if (DEBUG_MODE) console.log('Player wasm patched');
            });

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
                    isCacheDirty = true;
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

            // Wait for all to complete before starting the observer
            await Promise.all([emojiDataPromise, lottieCachePromise]);

            if (DEBUG_MODE) {
                console.log(
                    'Script startup time: ' +
                        (Date.now() - scriptStartTime) +
                        'ms'
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
