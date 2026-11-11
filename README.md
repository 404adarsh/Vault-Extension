# Markanm Vault browser extension

Clone the repository shown in Markanm Vault under **Settings → Browser extension**. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the cloned repository's `extension` folder. Then sign in to Markanm Vault, create an extension pairing key under **Settings → Browser extension**, and paste it into the extension popup.

The extension uses the same PNG logo files as the website. Its save animation is built locally with Three.js and bundled in `vendor/three-animation.js`; no animation code is loaded from a third-party server.

If you change the animation source, rebuild its bundle from the repository root:

```sh
npx vite build --config extension/vite.config.js
```

After updating the extension files, reload the extension and reload open browser tabs so the new content script and context-menu actions are registered.
