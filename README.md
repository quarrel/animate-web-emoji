# Animate Emoji Userscript

This userscript animates emojis on any website using the [Noto Animated Emoji](https://googlefonts.github.io/noto-emoji-animation/) set from Google and the [Lottie](https://airbnb.io/lottie/) animation library.

## Installation

1.  Install a userscript manager in your browser, such as:
    -   [Violentmonkey](https://violentmonkey.github.io/)
    -   [Tampermonkey](https://www.tampermonkey.net/)
2.  [Click here to install the userscript](https://github.com/quarrel/animate-web-emoji/raw/main/animated-emoji-q.user.js).

## How it works

The userscript uses a `MutationObserver` to watch for changes in the DOM. When new nodes are added, it scans them for emojis. If an emoji is found, it is replaced with a Lottie animation of the corresponding Noto Animated Emoji.

The emoji data is fetched from the [Noto Emoji Animation data source](https://googlefonts.github.io/noto-emoji-animation/data/api.json) and cached locally for 14 days to improve performance.

**Performance Enhancements:**

-   **Lazy Loading and Pausing:** Animations are lazy-loaded only when they become visible in the viewport. They are automatically paused when scrolled off-screen and resumed when they come back into view, significantly reducing CPU and GPU usage.
-   **Resource Management:** When animated emoji elements are removed from the DOM, their associated Lottie players are properly destroyed and removed from memory, preventing leaks on dynamic pages.
