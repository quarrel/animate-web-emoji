// ==UserScript==
// @name         Animate Emoji on the web --Q
// @namespace    Violentmonkey Scripts
// @version      2025-08-24_15-57
// @description  Animate emoji on the web using the noto animated emoji from Google.
// @author       Quarrel
// @homepage     https://github.com/quarrel/animate-web-emoji
// @match        *://*/*
// @run-at       document-start
// @icon         https://www.google.com/s2/favicons?sz=64&domain=emojicopy.com
// @noframes
// @require      https://cdn.jsdelivr.net/gh/quarrel/dotlottie-web-standalone@2133618935be739f13dd3b5b8d9a35d9ea47f407/build/dotlottie-web-iife.js
// @grant        GM.xmlhttpRequest
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.addStyle
// @license      MIT
// @downloadURL  https://greasyfork.org/en/scripts/546062-animate-emoji-on-the-web-q
// ==/UserScript==

'use strict';

const config = {
    DEBUG_MODE: false,
    WASM_PLAYER_URL:
        'https://cdn.jsdelivr.net/npm/@lottiefiles/dotlottie-web@0.50.0/dist/dotlottie-player.wasm',
    EMOJI_DATA_URL:
        'https://googlefonts.github.io/noto-emoji-animation/data/api.json',
    LOTTIE_URL_PATTERN:
        'https://fonts.gstatic.com/s/e/notoemoji/latest/{codepoint}/lottie.json',
    UNIQUE_EMOJI_CLASS: 'animated-emoji-q',
    EMOJI_DATA_CACHE_KEY: 'animated-emoji-q-noto-emoji-data-cache',
    LOTTIE_CACHE_KEY: 'animated-emoji-q-lottie',
    CACHE_EXPIRATION_MS: 14 * 24 * 60 * 60 * 1000, // 14 days
    DEBOUNCE_DELAY_MS: 10,
    DEBOUNCE_THRESHOLD: 25,
    MAX_CONCURRENT_REQUESTS: 8,
    SCALE_FACTOR: 1.1,
    WASM_CACHE_TTL: 24 * 60 * 60 * 1000, // 1 day
};

(async () => {
    try {
        // A minimal WASM module. (Basically a no-op).
        const module = new WebAssembly.Module(
            Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00)
        );
        new WebAssembly.Instance(module);
    } catch (e) {
        if (e.message.includes('Content Security Policy')) {
            console.warn(
                'Animated Emoji: Script disabled on this page due to Content Security Policy.'
            );
            return; // Exit the script early.
        }
    }

    const scriptStartTime = Date.now();
    const emojiRegex = /\p{RGI_Emoji}/gv;

    let requestQueue = [];
    let activeRequests = 0;

    let emojiDataPromise = null;
    let pendingLottieRequests = {};
    const emojiToCodepoint = new Map();

    GM.addStyle(`
        span.${config.UNIQUE_EMOJI_CLASS} {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            vertical-align: middle;
            line-height: 1;
            overflow: hidden;
        }
        
        span.${config.UNIQUE_EMOJI_CLASS} > canvas {
            /* Sizing is now set by JS */
            object-fit: contain;
            image-rendering: crisp-edges;
        }
    `);

    function base64ToBytes(base64) {
        const binString = atob(base64);
        return Uint8Array.from(binString, (char) => char.charCodeAt(0));
    }

    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        const CHUNK_SIZE = 1024;
        let binary = '';
        for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
            const chunk = bytes.subarray(i, i + CHUNK_SIZE);
            binary += String.fromCharCode.apply(null, chunk);
        }
        return btoa(binary);
    }

    const loadWasm = (url) => {
        return new Promise(async (resolve, reject) => {
            const CACHE_KEY = `wasm_cache_${url}`;
            const NOW = Date.now();

            const cached = await GM.getValue(CACHE_KEY, null);

            if (
                cached &&
                cached.code &&
                cached.timestamp > NOW - config.WASM_CACHE_TTL
            ) {
                if (config.DEBUG_MODE) {
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
            if (config.DEBUG_MODE) {
                console.log('Fetching WASM:', url);
            }

            GM.xmlhttpRequest({
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
                        await GM.setValue(CACHE_KEY, {
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
                    console.error('GM.xmlhttpRequest failed:', err);
                    reject(err);
                },
            });
        });
    };

    function patchFetchPlayer(bin) {
        const origFetch = window.fetch;
        window.fetch = new Proxy(origFetch, {
            apply(target, thisArg, args) {
                const resource = args[0];
                const url =
                    typeof resource === 'string' ? resource : resource.url;
                if (url.endsWith('dotlottie-player.wasm')) {
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

    const getEmojiData = () => {
        return new Promise(async (resolve, reject) => {
            const cachedData = await GM.getValue(
                config.EMOJI_DATA_CACHE_KEY,
                null
            );
            if (
                cachedData &&
                cachedData.timestamp > Date.now() - config.CACHE_EXPIRATION_MS
            ) {
                resolve(cachedData.data);
                return;
            }
            GM.xmlhttpRequest({
                method: 'GET',
                url: config.EMOJI_DATA_URL,
                responseType: 'json',
                onload: (response) => {
                    if (response.status === 200) {
                        const dataToCache = {
                            data: response.response,
                            timestamp: Date.now(),
                        };
                        GM.setValue(config.EMOJI_DATA_CACHE_KEY, dataToCache);
                        resolve(response.response);
                    } else {
                        reject('Failed to load emoji data');
                    }
                },
                onerror: reject,
            });
        });
    };

    function processRequestQueue() {
        if (
            requestQueue.length === 0 ||
            activeRequests >= config.MAX_CONCURRENT_REQUESTS
        ) {
            return;
        }

        activeRequests++;
        const { codepoint, resolve, reject } = requestQueue.shift();

        GM.xmlhttpRequest({
            method: 'GET',
            url: config.LOTTIE_URL_PATTERN.replace('{codepoint}', codepoint),
            responseType: 'json',
            onload: async (response) => {
                if (response.status === 200) {
                    const data = response.response;
                    const uniqueCacheKey = `${config.LOTTIE_CACHE_KEY}_${codepoint}`;
                    const dataToCache = {
                        data,
                        timestamp: Date.now(),
                    };
                    await GM.setValue(uniqueCacheKey, dataToCache);
                    resolve(data);
                } else {
                    reject('Failed to load Lottie animation: ' + codepoint);
                }
            },
            onerror: reject,
            onloadend: () => {
                activeRequests--;
                processRequestQueue();
            },
        });
    }

    const getLottieAnimationData = async (codepoint) => {
        // if we've got the promise, it is either resolved or we need to wait on it - serves a runtime cache to avoid hitting GM.getValue too
        if (pendingLottieRequests[codepoint]) {
            return pendingLottieRequests[codepoint];
        }

        const uniqueCacheKey = `${config.LOTTIE_CACHE_KEY}_${codepoint}`;

        const cached = await GM.getValue(uniqueCacheKey, null);
        if (
            cached &&
            cached.timestamp > Date.now() - config.CACHE_EXPIRATION_MS
        ) {
            if (config.DEBUG_MODE) {
                //console.log(`Lottie cache hit for ${codepoint}`);
            }
            return cached.data;
        }

        if (config.DEBUG_MODE) {
            //console.log(`Lottie cache miss for ${codepoint}, fetching...`);
        }
        const promise = new Promise((resolve, reject) => {
            requestQueue.push({ codepoint, resolve, reject });
            processRequestQueue();
        });

        pendingLottieRequests[codepoint] = promise;
        return promise;
    };

    const allDotLotties = new Set();

    const renderCfg = {
        devicePixelRatio: 1.5, // dottie can't be trusted, at least if you have changes in DPI during the page
        freezeOnOffscreen: true,
        autoResize: false,
    };
    const layoutCfg = {
        //fit: 'fill',
        align: [0.5, 0.5],
    };

    const sharedIO = new IntersectionObserver(
        async (entries) => {
            for (const entry of entries) {
                const span = entry.target;
                if (entry.isIntersecting) {
                    let player = span.dotLottiePlayer;
                    if (!player) {
                        getLottieAnimationData(span.dataset.codepoint)
                            .then((animationData) => {
                                const canvas = document.createElement('canvas');
                                // Set bitmap size
                                canvas.width = Math.round(span.finalSize * 0.9); // widths are mostly 90% of height, but feels weird to use it .. ???
                                canvas.height = Math.round(span.finalSize);
                                // Set CSS size
                                canvas.style.width = `${Math.round(
                                    span.finalSize * 0.9
                                )}px`;
                                canvas.style.height = `${Math.round(
                                    span.finalSize
                                )}px`;

                                /*
                                console.log(
                                    span.dataset.emoji +
                                        ': ' +
                                        'width = ' +
                                        canvas.width +
                                        ', height = ' +
                                        canvas.height +
                                        ', finalSize = ' +
                                        span.finalSize
                                );
                                */

                                // Clear the text placeholder before adding the canvas
                                span.textContent = '';
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
                            })
                            .catch((err) => {
                                if (config.DEBUG_MODE) {
                                    console.error(
                                        'Failed to load emoji animation, leaving as text.',
                                        err
                                    );
                                }
                                sharedIO.unobserve(span);
                            });
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

    // Pause/play all animations when tab visibility changes
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            allDotLotties.forEach((p) => p.pause());
        } else {
            allDotLotties.forEach((p) => p.play());
        }
    });
    // Shouldn't be needed?
    /*
        document.addEventListener('pagehide', () => {
            allDotLotties.forEach((p) => p.pause());
        });
    */

    function createLazyEmojiSpan(emoji, referenceNode) {
        const span = document.createElement('span');
        span.className = config.UNIQUE_EMOJI_CLASS;
        span.dataset.emoji = emoji;
        span.dataset.codepoint = emojiToCodepoint.get(emoji);
        span.title = `${emoji} (emoji u${emoji.codePointAt(0).toString(16)})`;

        let finalSize;
        if (referenceNode && referenceNode.parentNode) {
            const parentStyle = getComputedStyle(referenceNode.parentNode);
            const fontSizePx = parseFloat(parentStyle.fontSize);
            let blockSizePx = parseFloat(parentStyle.blockSize);

            if (isNaN(blockSizePx)) {
                blockSizePx = fontSizePx;
            }

            // If blockSize is significantly larger than fontSize, it's likely due to
            // line-height or padding. In such cases, fontSize is a more reliable measure.
            if (blockSizePx > fontSizePx * 1.2) {
                finalSize = Math.round(fontSizePx * config.SCALE_FACTOR);
            } else {
                finalSize = Math.round(blockSizePx);
            }
        } else {
            finalSize = 16; // Fallback size
        }

        span.finalSize = finalSize;

        span.textContent = emoji;

        sharedIO.observe(span);

        return span;
    }

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
                const parent = textNode.parentNode;
                if (!parent) return NodeFilter.FILTER_REJECT;

                if (SKIP.has(parent.nodeName)) {
                    return NodeFilter.FILTER_REJECT;
                }
                if (
                    parent.closest(
                        '[contenteditable=""]',
                        '[contenteditable="true"]'
                    )
                ) {
                    return NodeFilter.FILTER_REJECT;
                }
                if (parent.closest('.' + config.UNIQUE_EMOJI_CLASS)) {
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

            // we know we have emojis, now we need to make sure we have enough data loaded to create the span
            if (emojiDataPromise) {
                await emojiDataPromise;
                emojiDataPromise = null;
            }

            const emojisToProcess = matches
                .map((match) => {
                    const emojiStr = match[0];
                    const codepoint = emojiToCodepoint.get(emojiStr);
                    if (codepoint) {
                        if (config.DEBUG_MODE) {
                            console.log(emojiStr, codepoint);
                        }
                    }
                    return codepoint ? { match, codepoint } : null;
                })
                .filter(Boolean);

            if (emojisToProcess.length === 0) continue;
            // do we want to try and set to pre-fetching all the emoji? can cut this to do it only on demand as they appear in the visibility observer
            const promises = emojisToProcess.map((emoji) =>
                getLottieAnimationData(emoji.codepoint).catch(() => {
                    // This is for pre-fetching, errors will be handled by the IntersectionObserver
                })
            );

            const frag = document.createDocumentFragment();
            let lastIndex = 0;

            emojisToProcess.forEach((emoji, i) => {
                const { match } = emoji;

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

        for (const { textNode, frag } of replacements) {
            const parent = textNode.parentNode;
            if (!parent) {
                if (config.DEBUG_MODE) {
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
                        node.classList.contains(config.UNIQUE_EMOJI_CLASS)
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

        if (observerCount <= config.DEBOUNCE_THRESHOLD) {
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

        debouncedTimeout = setTimeout(
            processDebouncedNodes,
            config.DEBOUNCE_DELAY_MS
        );
    });

    const initializeEmojiData = async () => {
        const emojiData = await getEmojiData();
        for (const icon of emojiData.icons) {
            const chars = icon.codepoint
                .split('_')
                .map((hex) => String.fromCodePoint(parseInt(hex, 16)))
                .join('');
            emojiToCodepoint.set(chars, icon.codepoint);
        }
        if (config.DEBUG_MODE) {
            console.log(
                'Emoji cache loaded ' + (Date.now() - scriptStartTime) + 'ms'
            );
        }
    };

    const startObserver = () => {
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: false,
        });
        if (document.body) {
            processAddedNode(document.body);
        }
    };

    const main = async () => {
        try {
            if (config.DEBUG_MODE) {
                console.log(
                    'Script startup time: ' +
                        (Date.now() - scriptStartTime) +
                        'ms'
                );
            }

            // Defer heavy initialization to avoid blocking page load.
            setTimeout(() => {
                loadWasm(config.WASM_PLAYER_URL)
                    .then((bin) => {
                        patchFetchPlayer(bin);
                        if (config.DEBUG_MODE)
                            console.log(
                                'Player wasm patched after ' +
                                    (Date.now() - scriptStartTime) +
                                    'ms'
                            );
                    })
                    .catch((err) => {
                        if (config.DEBUG_MODE) {
                            console.error('Failed to load wasm', err);
                        }
                    });

                // Lottie cache initialization is removed.
                emojiDataPromise = initializeEmojiData();

                startObserver();
            }, 0);
        } catch (error) {
            if (config.DEBUG_MODE) {
                console.error(
                    'Failed to initialize emoji animation script:',
                    error
                );
            }
        }
    };

    main();
})();
