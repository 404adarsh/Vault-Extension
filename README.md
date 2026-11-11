# Markanm Vault — Quick Save Browser Extension

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-success?style=flat-square&logo=googlechrome)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Encryption](https://img.shields.io/badge/Encryption-AES--256--GCM-blue?style=flat-square&logo=keycdn)](https://en.wikipedia.org/wiki/Galois/Counter_Mode)
[![Zero-Knowledge](https://img.shields.io/badge/Architecture-Zero--Knowledge-brightgreen?style=flat-square)](https://markanm.com)
[![Platform](https://img.shields.io/badge/Platform-Chromium-orange?style=flat-square&logo=googlechrome)](https://www.google.com/chrome/)
[![License](https://img.shields.io/badge/License-MIT-purple?style=flat-square)](LICENSE)

**Markanm Vault — Quick Save** is a secure, privacy-first Chromium browser extension that pairs with [Markanm Vault](https://vault.markanm.com). It allows you to save website bookmarks, auto-detect submitted login credentials across web applications, manage collections, and decrypt passwords on demand—all protected by client-side, zero-knowledge AES-256-GCM encryption.

---

## 🌟 Key Features

* **🛡️ Zero-Knowledge Client-Side Encryption**: Secrets, credentials, and bookmarks are encrypted locally inside your browser using Web Crypto (`AES-256-GCM`) before transmitting to the server. Neither the host server nor intermediaries ever receive plaintext secrets or your master password.
* **⚡ Smart Login & Password Auto-Detection**:
  * Automatically detects submitted login forms, even across modern Single Page Applications (SPAs) and multi-step logins (where usernames and passwords are submitted on separate screens).
  * Prompts you with an unobtrusive top-right save bar where you can review, edit, or categorize credentials before saving.
  * Supports "Always Save" mode for frictionless 1-click password capture.
* **📂 Collection Management from the Extension**:
  * View, filter, and organize your vault items into custom folders and collections.
  * Create brand-new collections directly within the extension popup, dashboard, or in-page save prompt.
* **🖱️ Right-Click Context Menu**:
  * Right-click any link, page, image, or selected text to save it instantly into Markanm Vault.
* **🖥️ Dedicated Full Dashboard & Compact Popup**:
  * **Compact Popup**: Fast access to quick-save forms, recent items, and settings.
  * **Full Dashboard**: Search, filter by collection, switch between Grid and List views, and decrypt passwords with a single click.
* **🎨 Cyberpunk Save Effects & Theming**:
  * Choose from 7 color themes (Default, Cyber, Developer, Designer, Student, Finance, Gamer).
  * Configurable save completion animations including Matrix Rain, Neon Particles, Glitch, Scanlines, Confetti, and Three.js 3D renders.

---

## 🔐 Security Architecture

```
┌────────────────────────────────────────────────────────┐
│                   YOUR WEB BROWSER                     │
│                                                        │
│  [ Web Page Form ] ──► [ content.js (Detection) ]      │
│                                │                       │
│                                ▼                       │
│                 [ background.js Service Worker ]       │
│                                │                       │
│             Client-Side AES-256-GCM Encryption         │
│          (Using local 256-bit Extension Pair Key)      │
│                                │                       │
│                                ▼                       │
│                  Encrypted Ciphertext Only             │
└────────────────────────────────┬───────────────────────┘
                                 │
                                 ▼ (HTTPS)
             ┌───────────────────────────────────────┐
             │         MARKANM VAULT API             │
             │                                       │
             │  • Validates SHA-256 key fingerprint  │
             │  • Stores encrypted ciphertext payload│
             │  • Cannot read or decrypt data        │
             └───────────────────────────────────────┘
```

1. **Local Key Derivation**: When paired, your Vault account provisions a unique, cryptographically random 256-bit extension pairing key.
2. **Client-Side Encryption Only**:
   - `captureToCipher()` generates a fresh 96-bit Initialization Vector (`IV`) for every save operation.
   - The payload is encrypted with AES-256-GCM in the extension background service worker.
   - Only the resulting ciphertext and IV are posted to `/api/extension/capture`.
3. **Local Ephemeral Staging**: Pending login captures are held strictly in `chrome.storage.session` (in-memory only) and expire automatically after 10 minutes.
4. **Master Password Isolation**: Your Vault Master Password is **never** entered into or held by the extension. Only the authorized extension pairing key is stored in protected extension storage.

---

## 📋 Prerequisites

Collection loading and cache recovery are documented in [Collection visibility and extension sync](../docs/collection-sync.md). The extension gets an encrypted collection snapshot from the unlocked website; if a snapshot is not configured or the network is temporarily unavailable, it preserves its account-matched cache instead of clearing it.

* **Browser**: Google Chrome, Brave, Microsoft Edge, Opera, Vivaldi, or any Chromium-based browser supporting Manifest V3.
* **Vault Account**: An active account on [Markanm Vault](https://vault.markanm.com) (or your self-hosted Vault instance).

---

## 🚀 Installation & Setup

### Step 1: Download or Clone the Repository
Clone this repository to a folder on your computer:

```bash
git clone https://github.com/adarshsingh10100/Vault-Indus.git
cd Vault-Indus/extension
```
*(Or download the repository ZIP file from GitHub and extract the `extension` directory).*

### Step 2: Load Unpacked in Chrome

1. Open Google Chrome and enter this address in the URL bar:
   ```text
   chrome://extensions
   ```
2. In the top-right corner, toggle **Developer mode** to **ON**.
3. In the top-left corner, click the **Load unpacked** button.
4. Select the **`extension`** folder from the cloned repository.
5. The extension **Markanm Vault — Quick Save** will appear in your installed extensions list.
6. Click the Extensions puzzle piece icon (🧩) in the Chrome toolbar and pin **Markanm Vault** for quick access.

---

## 🔗 Pairing with Markanm Vault

To allow the extension to save and sync with your vault, pair it with your account:

### Method A: 1-Click Auto-Connect (Recommended)
1. Sign in to your [Markanm Vault](https://vault.markanm.com).
2. Go to **Settings** (`/vault/settings`) and select the **Browser extension** tab.
3. If not already generated, click **Create extension pairing key**.
4. The web page automatically detects your installed extension and connects immediately. You will see an **Extension Active** badge.
5. If needed, click the **1-Click Connect Installed Extension** button to re-sync at any time.

### Method B: Manual Key Pairing
1. Go to **Settings → Browser extension** in Markanm Vault.
2. Click **Copy key** to copy your 43-character pairing key (e.g. `u5yK9_...`).
3. Click the **Markanm Vault** extension icon in your browser toolbar to open the popup (or open the Dashboard).
4. Click **Effects & settings** (or look at the connection card in the dashboard).
5. Paste the pairing key into the **Extension pairing key** field and click **Connect extension**.
6. The status will turn green and display **Connected**.

---

## 💡 How to Use

### 1. Auto-Saving Logins on Any Website
* When you sign in to any website (e.g., GitHub, Google, Twitter, SnapCourse, etc.):
  * As soon as you submit your login, a floating prompt appears in the top-right corner:
    ```
    ┌──────────────────────────────────────────────┐
    │ 🔒 Save password to Markanm Vault?       [✕] │
    │ Username: [ your_username                  ] │
    │ Password: [ ••••••••••••••••••             ] │
    │ Collection: [ Personal               ▼ ]     │
    │ [ Save password ]           [ Not now ]      │
    └──────────────────────────────────────────────┘
    ```
  * Verify or adjust the captured username and password, select a collection, and click **Save password**.
  * The password is encrypted instantly and synced to your vault.

### 2. Quick Saving Bookmarks & Notes
* Click the extension icon in the toolbar.
* Click **＋ Quick save**.
* Choose your item type:
  * `Website / video bookmark`
  * `Password`
  * `API key` / `Token`
  * `Secure note`
  * `Database` / `SSH` / `Wi-Fi`
* Select a collection (or click **+ New** to create a collection inline).
* Click **Encrypt and save**.

### 3. Right-Click Context Menu
* Right-click anywhere on any web page:
  * Click **Save link to Markanm Vault** on links.
  * Click **Save this page to Markanm Vault** on open pages or image selections.

### 4. Viewing & Decrypting in the Dashboard
* Click the extension icon and select **Dashboard ↗** (or visit `chrome-extension://<id>/dashboard.html`).
* Search through all your saved bookmarks and credentials.
* Click **View** on any secret: the value decrypts locally and renders with a visual scramble animation before revealing the plaintext, with a 1-click **Copy** button. The secret automatically re-masks after 10 seconds for privacy.

---

## 📂 File Structure

```text
extension/
├── manifest.json              # Chrome Extension Manifest V3 configuration & permissions
├── background.js              # Service Worker: encryption, secure storage, network API sync
├── content.js                 # In-page content script: form detection, save UI, context menus
├── content-ui.css             # Styles for in-page dialogs and floating save prompts
├── popup.html                 # Toolbar popup HTML interface
├── popup.js                   # Popup UI logic, quick-save form, animation trigger
├── popup.css                  # Modern dark-themed styling for the popup
├── dashboard.html             # Standalone full-page dashboard UI
├── dashboard.js               # Dashboard controller: search, filtering, decrypt, collections
├── dashboard.css              # Grid & list styles for the full dashboard
├── effects.js                 # Canvas animation engine (Particles, Matrix, Glitch, Scanlines)
├── vite.config.js             # Bundler configuration for Three.js animations
├── icons/                     # Extension branding icons (16px, 32px, 192px, 512px)
└── vendor/
    └── three-animation.js     # Bundled Three.js 3D save animation
```

---

## ⚙️ Configuration & Custom API Endpoints

By default, the extension connects to the production instance at `https://vault.markanm.com`.

If you are running a self-hosted or local instance of Markanm Vault:
1. When you pair via **Method A (1-Click Auto-Connect)** from your local Vault URL (e.g. `http://localhost:5173`), the extension automatically records your custom origin.
2. In `extension/manifest.json`, local development origins (`http://localhost:*/*` and `http://127.0.0.1:*/*`) are pre-whitelisted in `host_permissions`.
3. To change the default fallback API origin, edit line 1 in `extension/background.js`:
   ```javascript
   const PRODUCTION_API = 'https://your-custom-vault-domain.com'
   ```

---

## 🛠️ Development & Building

### Reloading After Edits
Unlike regular web pages, extensions require a reload when modified:
1. Edit any file in the `extension/` folder.
2. Go to `chrome://extensions`.
3. Click the **Reload (🔄)** button on the **Markanm Vault — Quick Save** card.
4. Reload any active browser tabs where you want to test the updated content scripts.

### Rebuilding the 3D Animation Bundle
The Three.js animation module is bundled locally to eliminate external CDN dependencies:
```bash
# From repository root:
npm install
npx vite build --config extension/vite.config.js
```

---

## ❓ Troubleshooting & FAQ

#### 1. Why does the popup or dashboard say "Extension Not Connected"?
Your extension needs to be paired with your Vault account. Go to Markanm Vault → **Settings** → **Browser extension** and click **1-Click Connect Installed Extension**, or paste your pairing key into the extension popup.

#### 2. Why are my collections showing "No collection"?
Collections are synced from your Vault upon pairing. If you just paired or added new collections in Vault, click **Refresh** in the extension popup or dashboard.

#### 3. Does Markanm ever see my master password?
**No.** Your master password is never sent to the server and is never stored in the extension. The extension only holds the 256-bit pairing key generated by your vault. All encryption and decryption happen strictly in your browser using the standard Web Crypto API.

#### 4. Can I use this in Brave, Edge, or other browsers?
**Yes.** Any browser that supports Chromium Manifest V3 extensions can install and run this extension using the **Load unpacked** procedure.

---

## 📄 License

This extension is open source and distributed under the [MIT License](LICENSE). Built with 🔒 privacy in mind by the [Markanm Vault](https://vault.markanm.com) team.
