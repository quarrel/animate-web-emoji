const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(require('node:path').join(__dirname, '../animated-emoji-q.user.js'), 'utf8');

async function setup({ wasmBlocked = false, wasmFails = false, jsFails = false } = {}) {
    const players = [];
    let wasmURL;
    class Player {
        static setWasmUrl(url) { wasmURL = url; }
        constructor(kind = 'wasm') {
            if (typeof kind === 'object') kind = 'wasm';
            this.kind = kind;
            this.listeners = new Map();
            players.push(this);
            setImmediate(() => this.emit(
                kind === 'wasm' ? (wasmFails ? 'loadError' : 'load')
                    : (jsFails ? 'data_failed' : 'DOMLoaded')
            ));
        }
        addEventListener(event, fn) { this.listeners.set(event, fn); }
        removeEventListener(event) { this.listeners.delete(event); }
        emit(event) { this.listeners.get(event)?.({}); }
        destroy() { this.destroyed = true; }
        play() { this.playing = true; }
    }
    const context = vm.createContext({
        window: { DotLottie: Player },
        lottie: { loadAnimation: () => new Player('js') },
        WebAssembly: wasmBlocked ? { Module: class { constructor() { throw new Error('WASM unavailable'); } } } : WebAssembly,
        GM: {
            getResourceURL: async () => 'blob:test-wasm',
            getValue: async () => JSON.stringify({ timestamp: Date.now(), data: {} }),
            addElement() { throw new Error('Page script injection blocked by CSP'); },
        },
        document: {
            hidden: false,
            addEventListener() {},
            createElement: () => ({ style: {}, getContext: () => ({}) }),
        },
        IntersectionObserver: class { unobserve() {} },
        MutationObserver: class {},
        setTimeout, clearTimeout, console,
    });
    // Exercise the actual loader without starting the unrelated DOM scanner.
    await vm.runInContext(source.replace('    main();',
        '    globalThis.loader = { initializePlayer, loadAnimationForSpan };'), context);
    const span = {
        textContent: '😀', finalSize: 24, isConnected: true,
        animationVisible: true, dataset: { codepoint: '1f600' },
        replaceChildren(canvas) { this.textContent = ''; this.canvas = canvas; },
    };
    return { ...context.loader, span, players, wasmURL, context };
}

test('awaits resource URL and preserves text until WASM is ready without page injection', async () => {
    const env = await setup();
    assert.equal(env.wasmURL, 'blob:test-wasm');
    const loading = env.initializePlayer(env.span, {});
    assert.equal(env.span.textContent, '😀');
    await loading;
    assert.ok(env.span.canvas);
    assert.equal(env.span.dotLottiePlayer.kind, 'wasm');
    assert.equal(env.span.dotLottiePlayer.playing, true);
});

test('blocked WASM selects JavaScript player', async () => {
    const env = await setup({ wasmBlocked: true });
    await env.initializePlayer(env.span, {});
    assert.equal(env.span.dotLottiePlayer.kind, 'js');
});

test('asynchronous WASM failure destroys player and falls back', async () => {
    const env = await setup({ wasmFails: true });
    await env.initializePlayer(env.span, {});
    assert.equal(env.players[0].destroyed, true);
    assert.equal(env.span.dotLottiePlayer.kind, 'js');
});

test('both players failing leaves original emoji intact', async () => {
    const env = await setup({ wasmFails: true, jsFails: true });
    await assert.rejects(env.initializePlayer(env.span, {}));
    assert.equal(env.span.textContent, '😀');
    assert.equal(env.span.canvas, undefined);
    assert.ok(env.players.every(player => player.destroyed));
});

test('repeated visibility callbacks do not create duplicate players', async () => {
    const env = await setup();
    await Promise.all([env.loadAnimationForSpan(env.span), env.loadAnimationForSpan(env.span)]);
    assert.equal(env.players.length, 1);
});

test('detached emoji is not replaced after loading completes', async () => {
    const env = await setup();
    const loading = env.initializePlayer(env.span, {});
    env.span.isConnected = false;
    await loading;
    assert.equal(env.span.canvas, undefined);
    assert.equal(env.players[0].destroyed, true);
});

test('emoji that scrolls away during loading stays paused', async () => {
    const env = await setup();
    const loading = env.initializePlayer(env.span, {});
    env.span.animationVisible = false;
    await loading;
    assert.equal(env.span.dotLottiePlayer.playing, undefined);
});
