# Animate Emoji Userscript

This userscript animates emojis on any website using the [Noto Animated Emoji](https://googlefonts.github.io/noto-emoji-animation/) set from Google.

![Animated Emoji Demo](assets/animated-emoji.gif)

## Installation

1.  Install a userscript manager in your browser, such as:
    -   [Violentmonkey](https://violentmonkey.github.io/)
    -   [Tampermonkey](https://www.tampermonkey.net/)
2.  [Visit this script on Greasyfork to install safely](https://greasyfork.org/en/scripts/546062-animate-emoji-on-the-web-q).

### Updating the local fix in Chrome

1. Open `chrome://extensions`, select **Violentmonkey → Details**, and ensure **Allow User Scripts** is enabled. Chrome 138 and newer use this per-extension permission ([Chrome documentation](https://developer.chrome.com/blog/chrome-userscript)). Also check that Violentmonkey is enabled and has site access for the page you are testing.
2. In the Violentmonkey dashboard, edit the existing script and replace its entire contents with `animated-emoji-q.user.js`, including the metadata header. Save and let its dependencies finish downloading.
3. Reload a normal web page containing supported emoji such as 😀 or 🎉. Chrome's internal pages cannot run this script, and Hacker News is explicitly excluded.

The September 2026 fix loads both player libraries with `@require` in the userscript context, replacing page-level `GM.addElement('script', ...)` injection. This avoids depending on page script injection under CSP/Trusted Types and keeps the libraries accessible in content mode. The WASM resource URL is awaited, and a WASM loading failure falls back to the JavaScript renderer. Original emoji remain visible until an animation successfully loads.

### Validation

Run `node --check animated-emoji-q.user.js` and `node --test tests/player-loading.test.cjs` (Node 22 or newer). The tests use mocked browser and userscript APIs to cover player loading, WASM fallback, preserving text on failure, duplicate loading, and removal/visibility during loading. They do not establish compatibility with an installed extension.

For a browser smoke test, check a normal page and a page with a strict CSP, confirm emoji animate, then scroll them out of view and back. If they remain static, enable `DEBUG_MODE` and inspect the browser console for `Animated emoji` messages. These local changes must be installed in Violentmonkey before they affect browsing; the Greasyfork copy is separate.

## Key Features

-   **High-Quality Animations**: Replaces standard text emojis with Google's high-resolution [Noto animated versions](https://googlefonts.github.io/noto-emoji-animation/).

    -   As such, you will see a smaller transition from your base emoji font if it is already based on Noto. If you're interested in knowing how to achieve that on Windows 11, see me on another project of mine: [Web Emoji in Win11](https://github.com/quarrel/broken-flag-emojis-win11-twemoji)

-   **Seamless User Experience**:

    -   **Graceful Placeholders**: The original static emoji is shown while the animation loads, preventing blank spaces and content shifting.
    -   **Smart Playback**: Animations automatically pause when they are scrolled off-screen or when the browser tab is in the background, saving CPU and battery life.

-   **Highly Performant & Efficient**:

    -   **Lazy Loading**: Animation data is only downloaded when an emoji is about to scroll into view, saving bandwidth on long pages.
    -   **Persistent Caching**: Animation data is cached locally for 14 days. Emojis you've seen before will load instantly with no network request.
    -   **Rate-Limited Requests**: A request queue prevents the script from overwhelming servers by limiting concurrent downloads, ensuring smooth performance.

-   **Safe & Compatible**:
    -   The script is designed to be robust, intelligently avoiding execution in sensitive areas like text editors (`contenteditable`), code blocks, or `<script>` tags.
    -   **CSP Compliant**: Works on sites with a strict Content Security Policy (like Instagram, Bluesky, etc.) by using privileged script manager APIs for loading libraries and making requests.
