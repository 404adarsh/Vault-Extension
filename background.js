const PRODUCTION_API = 'https://vault.markanm.com'

// Remove credentials staged by older extension builds. New prompts are
// encrypted and kept only in session storage.
void chrome.storage.local.remove('pendingCapture')

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.remove('pendingCapture')
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'markanm-save-link', title: 'Save link to Markanm Vault', contexts: ['link'] })
    chrome.contextMenus.create({ id: 'markanm-save-page', title: 'Save this page to Markanm Vault', contexts: ['page', 'selection', 'image'] })
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return
  const url = info.menuItemId === 'markanm-save-link' ? info.linkUrl : info.srcUrl || info.pageUrl
  const title = info.menuItemId === 'markanm-save-link' ? (info.linkText || '') : info.selectionText?.trim() || tab.title || ''
  if (!url) return
  void chrome.tabs.sendMessage(tab.id, { type: 'vault-open-bookmark', url, title, selectionText: info.selectionText || '', isImage: Boolean(info.srcUrl) }).catch(() => undefined)
})

function decodeKey(value) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function toBase64(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function credentialFingerprint(capture, keyText) {
  const username = String(capture?.username || '').trim().toLowerCase()
  const password = String(capture?.password || '')
  if (!username || !password) return null
  let hostname
  try { hostname = new URL(String(capture.url || '')).hostname.toLowerCase().replace(/^www\./, '') } catch { return null }
  const rawKey = decodeKey(keyText)
  if (rawKey.byteLength !== 32) throw new Error('Pairing key is invalid. Re-pair the extension from Vault settings.')
  const data = new TextEncoder().encode(`vault:credential-fingerprint:v1\n${hostname}\n${username}\n${password}`)
  try {
    const key = await crypto.subtle.importKey('raw', rawKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, data))
    try { return toBase64(digest).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') } finally { digest.fill(0) }
  } finally {
    rawKey.fill(0)
    data.fill(0)
  }
}

async function cacheRecentCapture(capture, cipher) {
  const { recentItems = [], pairingKey, savedCredentialFingerprints = [] } = await chrome.storage.local.get(['recentItems', 'pairingKey', 'savedCredentialFingerprints'])
  const fingerprint = capture?.type === 'password' && pairingKey ? await credentialFingerprint(capture, pairingKey) : null
  const recent = {
    id: crypto.randomUUID(), type: String(capture?.type || 'custom'),
    title: String(capture?.title || 'Saved item').slice(0, 160),
    url: String(capture?.url || '').slice(0, 2000), collectionId: capture?.collectionId || null,
    createdAt: Date.now(), cipher,
  }
  await chrome.storage.local.set({
    recentItems: [recent, ...recentItems].slice(0, 30),
    ...(fingerprint ? { savedCredentialFingerprints: [...new Set([...savedCredentialFingerprints, fingerprint])].slice(-5000) } : {}),
  })
}

async function stageCredentialCapture(capture) {
  const { pairingKey } = await chrome.storage.local.get('pairingKey')
  if (!pairingKey) throw new Error('Pair the extension with Vault to save logins.')
  const cipher = await captureToCipher(capture, pairingKey)
  const { pendingCredentialPrompts = [] } = await chrome.storage.session.get('pendingCredentialPrompts')
  const now = Date.now()
  const pending = pendingCredentialPrompts.filter((entry) => entry.createdAt > now - 10 * 60_000)
  const id = crypto.randomUUID()
  pending.push({ id, createdAt: now, hostname: new URL(capture.url).hostname.toLowerCase(), cipher })
  await chrome.storage.session.set({ pendingCredentialPrompts: pending.slice(-5) })
  return id
}

async function deleteStagedCredential(id) {
  const { pendingCredentialPrompts = [] } = await chrome.storage.session.get('pendingCredentialPrompts')
  await chrome.storage.session.set({ pendingCredentialPrompts: pendingCredentialPrompts.filter((entry) => entry.id !== id) })
}

async function credentialAlreadySaved(capture, keyText) {
  const fingerprint = await credentialFingerprint(capture, keyText)
  if (!fingerprint) return false
  const [snapshot, stored] = await Promise.all([
    fetchCollections().catch(() => null),
    chrome.storage.local.get(['savedCredentialFingerprints', 'recentItems']),
  ])
  const known = new Set([
    ...(Array.isArray(snapshot?.credentialFingerprints) ? snapshot.credentialFingerprints : []),
    ...(Array.isArray(stored.savedCredentialFingerprints) ? stored.savedCredentialFingerprints : []),
  ])
  if (known.has(fingerprint)) return true
  // Older extension saves predate fingerprint caching. Their local copies are
  // encrypted, so compare them only after decrypting in the paired extension.
  for (const recent of Array.isArray(stored.recentItems) ? stored.recentItems : []) {
    if (recent.type !== 'password' || !recent.cipher) continue
    try {
      const savedCapture = await decryptWithPairKey(recent.cipher, keyText)
      if (await credentialFingerprint(savedCapture, keyText) === fingerprint) return true
    } catch { /* Ignore malformed or obsolete local cache entries. */ }
  }
  return false
}

async function captureToCipher(capture, keyText) {
  const rawKey = decodeKey(keyText)
  if (rawKey.byteLength !== 32) throw new Error('Pairing key is invalid. Re-pair the extension from Vault settings.')
  try {
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt'])
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const plaintext = new TextEncoder().encode(JSON.stringify(capture))
    try {
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
      return { version: 1, algorithm: 'AES-256-GCM', iv: toBase64(iv), data: toBase64(new Uint8Array(encrypted)) }
    } finally {
      iv.fill(0)
      plaintext.fill(0)
    }
  } finally {
    rawKey.fill(0)
  }
}

async function decryptWithPairKey(cipher, keyText) {
  const rawKey = decodeKey(keyText)
  try {
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt'])
    const iv = Uint8Array.from(atob(cipher.iv), (character) => character.charCodeAt(0))
    const data = Uint8Array.from(atob(cipher.data), (character) => character.charCodeAt(0))
    const algorithm = { name: 'AES-GCM', iv }
    if (cipher.version === 2) algorithm.additionalData = new TextEncoder().encode('vault:extension:capture:v1')
    const plaintext = new Uint8Array(await crypto.subtle.decrypt(algorithm, key, data))
    try {
      return JSON.parse(new TextDecoder().decode(plaintext))
    } finally {
      plaintext.fill(0)
      rawKey.fill(0)
    }
  } finally {
    rawKey.fill(0)
  }
}

async function sendCapture(capture) {
  const settings = await chrome.storage.local.get(['pairingKey', 'apiOrigin'])
  if (!settings.pairingKey) throw new Error('Pair the extension from Markanm Vault settings first.')
  if (!capture || typeof capture !== 'object' || !['bookmark', 'password', 'api-key', 'token', 'database', 'ssh', 'wifi', 'note', 'custom', 'collection'].includes(capture.type)) {
    throw new Error('Choose a valid item type before saving.')
  }
  if (capture.type === 'bookmark') {
    let parsed
    try { parsed = new URL(String(capture.url || '')) } catch { throw new Error('This link does not have a valid web address.') }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Only standard web links can be saved.')
    capture = { ...capture, url: parsed.href.slice(0, 2000), title: String(capture.title || '').slice(0, 160), description: String(capture.description || '').slice(0, 4000), username: '', password: '', fields: [] }
  }
  const apiOrigin = settings.apiOrigin || PRODUCTION_API
  try {
    const parsed = new URL(apiOrigin)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
  } catch {
    throw new Error('Unsupported Vault API address.')
  }
  const cipher = await captureToCipher(capture, settings.pairingKey)
  const response = await fetch(`${apiOrigin}/api/extension/capture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.pairingKey}`,
    },
    body: JSON.stringify({ cipher }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.message || result.error || result.data?.message || 'Vault could not accept this capture.')
  return cipher
}

async function fetchCollections() {
  const settings = await chrome.storage.local.get(['pairingKey', 'apiOrigin'])
  if (!settings.pairingKey) throw new Error('Create a Vault account or sign in, then pair this extension from Settings → Browser extension.')
  const fingerprintBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(settings.pairingKey)))
  const owner = Array.from(fingerprintBytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  fingerprintBytes.fill(0)
  const stored = await chrome.storage.local.get(['snapshotCache', 'snapshotCacheOwner', 'customCollections'])
  const cached = stored.snapshotCacheOwner === owner && stored.snapshotCache ? stored.snapshotCache : { collections: [], bookmarks: [] }
  const apiOrigin = settings.apiOrigin || PRODUCTION_API
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    let response
    try {
      response = await fetch(`${apiOrigin}/api/extension/collections`, { headers: { 'Authorization': `Bearer ${settings.pairingKey}` }, signal: controller.signal })
    } finally {
      clearTimeout(timeout)
    }
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.message || result.error || result.data?.message || 'Unable to load Vault collections.')
    const decoded = result.data?.cipher ? await decryptWithPairKey(result.data.cipher, settings.pairingKey) : null
    let serverCollections = Array.isArray(decoded)
      ? decoded.filter((entry) => typeof entry.id === 'string' && typeof entry.title === 'string')
      : (Array.isArray(decoded?.collections) ? decoded.collections.filter((entry) => typeof entry.id === 'string' && typeof entry.title === 'string').map((entry) => ({ ...entry, parentId: typeof entry.parentId === 'string' ? entry.parentId : null })) : [])
    const serverBookmarks = Array.isArray(decoded?.bookmarks) ? decoded.bookmarks.filter((entry) => typeof entry.id === 'string' && typeof entry.title === 'string' && typeof entry.url === 'string' && /^https?:\/\//i.test(entry.url)) : []
    const credentialFingerprints = Array.isArray(decoded?.credentialFingerprints) ? decoded.credentialFingerprints.filter((entry) => typeof entry === 'string') : []

    // Merge any locally created collections
    const custom = Array.isArray(stored.customCollections) ? stored.customCollections : []
    const mergedCollections = [...serverCollections]
    for (const c of custom) {
      // Names are not unique: nested collections can have the same title.
      // Only IDs identify the same collection.
      if (!mergedCollections.some((sc) => sc.id === c.id)) {
        mergedCollections.push(c)
      }
    }
    const fresh = { collections: mergedCollections, bookmarks: serverBookmarks, credentialFingerprints }
    if (JSON.stringify(fresh) !== JSON.stringify(cached)) await chrome.storage.local.set({ snapshotCache: fresh, snapshotCacheOwner: owner })
    return fresh
  } catch (error) {
    if (cached.collections.length || cached.bookmarks.length) return { ...cached, stale: true, error: error instanceof Error ? error.message : 'Unable to load current Vault collections.' }
    throw error
  }
}


chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'vault-settings') {
    void chrome.storage.local.get(['pairingKey', 'alwaysSave', 'apiOrigin']).then((settings) =>
      respond({
        paired: Boolean(settings.pairingKey),
        alwaysSave: Boolean(settings.alwaysSave),
        apiOrigin: settings.apiOrigin || PRODUCTION_API,
      })
    )
    return true
  }
  if (message?.type === 'vault-fetch-collections') {
    void fetchCollections().then((snapshot) => respond({ ok: true, ...snapshot })).catch((error) => respond({ ok: false, error: error instanceof Error ? error.message : 'Unable to load collections.' }))
    return true
  }
  if (message?.type === 'vault-pair') {
    let key = String(message.key || '').trim().replace(/^['"]|['"]$/g, '')
    key = key.replace(/=+$/, '').replaceAll('+', '-').replaceAll('/', '_')
    if (!/^[A-Za-z0-9_-]{43}$/.test(key)) {
      respond({ ok: false, error: 'Paste the 43-character pairing key from Vault settings.' })
      return false
    }
    const apiOrigin = message.apiOrigin || null
    void (async () => {
      const previous = await chrome.storage.local.get(['pairingKey', 'snapshotCache', 'snapshotCacheOwner', 'recentItems', 'apiOrigin', 'savedCredentialFingerprints'])
      const toSet = { pairingKey: key }
      if (apiOrigin) toSet.apiOrigin = apiOrigin
      await chrome.storage.local.set(toSet)
      try {
        await fetchCollections()
        if (previous.pairingKey !== key) {
          await chrome.storage.local.remove(['recentItems', 'savedCredentialFingerprints'])
        }
        respond({ ok: true })
      } catch (error) {
        if (previous.pairingKey) await chrome.storage.local.set(previous)
        else await chrome.storage.local.remove(['pairingKey', 'snapshotCache', 'snapshotCacheOwner'])
        respond({ ok: false, error: error instanceof Error ? error.message : 'Could not verify the pairing key with Vault.' })
      }
    })().catch((error) => respond({ ok: false, error: error instanceof Error ? error.message : 'Unable to save the pairing key.' }))
    return true
  }
  if (message?.type === 'vault-create-collection') {
    void (async () => {
      const title = String(message.title || '').trim().slice(0, 160)
      if (!title) {
        respond({ ok: false, error: 'Enter a collection name.' })
        return
      }
      const settings = await chrome.storage.local.get(['pairingKey', 'apiOrigin', 'customCollections', 'snapshotCache'])
      if (!settings.pairingKey) {
        respond({ ok: false, error: 'Pair the extension from Vault settings first.' })
        return
      }
      const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
      const newCol = { id, title, parentId: null }
      const custom = Array.isArray(settings.customCollections) ? settings.customCollections : []
      const nextCustom = [...custom.filter((c) => c.id !== id), newCol]
      const snapshot = settings.snapshotCache || { collections: [], bookmarks: [] }
      const nextCols = [...(snapshot.collections || []).filter((c) => c.id !== id), newCol]
      await chrome.storage.local.set({
        customCollections: nextCustom,
        snapshotCache: { ...snapshot, collections: nextCols }
      })
      try {
        const capture = {
          type: 'collection',
          title,
          description: '',
          url: '',
          username: '',
          password: '',
          collectionId: null,
          fields: [{ name: 'collectionId', value: id }]
        }
        await sendCapture(capture)
      } catch {}
      respond({ ok: true, collection: newCol })
    })().catch((err) => respond({ ok: false, error: err instanceof Error ? err.message : 'Unable to create collection.' }))
    return true
  }
  if (message?.type === 'vault-unpair') {
    void Promise.all([
      chrome.storage.local.remove(['pairingKey', 'snapshotCache', 'snapshotCacheOwner', 'recentItems', 'savedCredentialFingerprints']),
      chrome.storage.session.remove('pendingCredentialPrompts'),
    ]).then(() => respond({ ok: true }))
    return true
  }
  if (message?.type === 'vault-always-save') {
    void chrome.storage.local.set({ alwaysSave: Boolean(message.enabled) }).then(() => respond({ ok: true }))
    return true
  }
  if (message?.type === 'vault-save-capture') {
    void sendCapture(message.capture)
      .then(async (cipher) => {
        await cacheRecentCapture(message.capture, cipher)
        if (message.pendingId) await deleteStagedCredential(message.pendingId)
        await fetchCollections().catch(() => undefined)
        respond({ ok: true })
      })
      .catch((error) => respond({ ok: false, error: error instanceof Error ? error.message : 'Unable to save this password.' }))
    return true
  }
  if (message?.type === 'vault-decrypt-capture') {
    void chrome.storage.local.get(['pairingKey']).then(async ({ pairingKey }) => {
      if (!pairingKey) throw new Error('Pair the extension again to view this item.')
      const capture = await decryptWithPairKey(message.cipher, pairingKey)
      respond({ ok: true, capture })
    }).catch((error) => respond({ ok: false, error: error instanceof Error ? error.message : 'Unable to decrypt this item.' }))
    return true
  }
  if (message?.type === 'vault-detected-capture') {
    void chrome.storage.local.get(['pairingKey', 'alwaysSave']).then(async (settings) => {
      if (!settings.pairingKey) {
        respond({ ok: false, mode: 'unpaired', error: 'Open the extension to pair it with Vault.' })
        return
      }
      if (message.capture?.type === 'password' && await credentialAlreadySaved(message.capture, settings.pairingKey)) {
        respond({ ok: true, mode: 'existing' })
        return
      }
      if (settings.alwaysSave) {
        const tabId = sender.tab?.id
        if (Number.isInteger(tabId)) void chrome.tabs.sendMessage(tabId, { type: 'vault-auto-save-progress', phase: 'saving', title: String(message.capture?.title || '').slice(0, 160) }).catch(() => undefined)
        try {
          const cipher = await sendCapture(message.capture)
          await cacheRecentCapture(message.capture, cipher)
          await fetchCollections().catch(() => undefined)
          if (Number.isInteger(tabId)) void chrome.tabs.sendMessage(tabId, { type: 'vault-auto-save-progress', phase: 'done', title: String(message.capture?.title || '').slice(0, 160) }).catch(() => undefined)
          respond({ ok: true, mode: 'saved' })
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'Unable to save this password.'
          if (Number.isInteger(tabId)) void chrome.tabs.sendMessage(tabId, { type: 'vault-auto-save-progress', phase: 'error', title: String(message.capture?.title || '').slice(0, 160), error: reason }).catch(() => undefined)
          respond({ ok: false, mode: 'error', error: reason })
        }
      } else {
        try {
          const pendingId = await stageCredentialCapture(message.capture)
          respond({ ok: true, mode: 'ask', pendingId })
        } catch (error) {
          respond({ ok: false, mode: 'error', error: error instanceof Error ? error.message : 'Unable to prepare the password save prompt.' })
        }
      }
    })
    return true
  }
  if (message?.type === 'vault-get-pending-capture') {
    void (async () => {
      const [{ pendingCredentialPrompts = [] }, { pairingKey }] = await Promise.all([
        chrome.storage.session.get('pendingCredentialPrompts'), chrome.storage.local.get('pairingKey'),
      ])
      if (!pairingKey) return respond({ ok: false })
      const now = Date.now()
      const active = pendingCredentialPrompts.filter((entry) => entry.createdAt > now - 10 * 60_000)
      if (active.length !== pendingCredentialPrompts.length) await chrome.storage.session.set({ pendingCredentialPrompts: active })
      const currentHost = String(message.hostname || '').toLowerCase()
      const entry = active.find((candidate) => {
        const savedHost = String(candidate.hostname || '').toLowerCase()
        return currentHost && savedHost && (currentHost === savedHost || currentHost.endsWith(`.${savedHost}`) || savedHost.endsWith(`.${currentHost}`))
      })
      if (!entry) return respond({ ok: false })
      const capture = await decryptWithPairKey(entry.cipher, pairingKey)
      respond({ ok: true, id: entry.id, capture })
    })().catch((error) => respond({ ok: false, error: error instanceof Error ? error.message : 'Unable to read the pending save prompt.' }))
    return true
  }
  if (message?.type === 'vault-clear-pending-capture') {
    const id = String(message.id || '')
    if (!id) {
      respond({ ok: false, error: 'Pending capture ID is required.' })
      return false
    }
    void deleteStagedCredential(id).then(() => respond({ ok: true }))
    return true
  }
  return false
})
