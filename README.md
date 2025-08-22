# Animate Emoji Userscript

This userscript animates emojis on any website using the [Noto Animated Emoji](https://googlefonts.github.io/noto-emoji-animation/) set from Google.

![Animated Emoji Demo](assets/animated-emoji.gif)

## Installation

1.  Install a userscript manager in your browser, such as:
    -   [Violentmonkey](https://violentmonkey.github.io/)
    -   [Tampermonkey](https://www.tampermonkey.net/)
2.  [Visit this script on Greasyfork to install safely](https://greasyfork.org/en/scripts/546062-animate-emoji-on-the-web-q).

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
