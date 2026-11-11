const $ = (selector) => document.querySelector(selector)
const themes = ['default', 'cyber', 'developer', 'designer', 'student', 'finance', 'gamer']
let entries = []
let collections = []
let selectedCollection = ''
let layout = 'grid'
let refreshPending = false
let currentApiOrigin = 'https://vault.markanm.com'

function send(message) {
  return chrome.runtime.sendMessage(message)
}

function openVaultSettings() {
  void chrome.tabs.create({ url: `${currentApiOrigin}/vault/settings` })
}

function themeAccent(name) {
  const current = document.documentElement.dataset.theme
  document.documentElement.dataset.theme = name
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  document.documentElement.dataset.theme = current || 'default'
  return accent
}

function renderThemeButtons(selected) {
  const root = $('#theme-picker')
  root.replaceChildren()
  for (const theme of themes) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'theme-swatch'
    button.style.setProperty('--swatch', themeAccent(theme))
    button.title = theme
    button.setAttribute('aria-label', `Use ${theme} theme`)
    button.setAttribute('aria-pressed', String(theme === selected))
    button.addEventListener('click', () => void setTheme(theme))
    root.append(button)
  }
}

async function setTheme(theme) {
  document.documentElement.dataset.theme = theme
  await chrome.storage.local.set({ theme })
  renderThemeButtons(theme)
}

function renderCollections() {
  const root = $('#collections')
  root.replaceChildren()
  const byId = new Map(collections.map((entry) => [entry.id, entry]))
  const path = (entry) => {
    const parent = entry.parentId ? byId.get(entry.parentId) : null
    return parent ? `${path(parent)} / ${entry.title}` : entry.title
  }
  for (const collection of [...collections].sort((a, b) => path(a).localeCompare(path(b)))) {
    const button = document.createElement('button')
    button.className = `nav${collection.id === selectedCollection ? ' active' : ''}`
    button.textContent = path(collection)
    button.title = path(collection)
    button.dataset.collection = collection.id
    button.addEventListener('click', () => {
      selectedCollection = collection.id
      renderCollections()
      renderItems()
    })
    root.append(button)
  }
}

function renderItems() {
  const root = $('#items')
  root.className = `items ${layout}`
  root.replaceChildren()
  const query = $('#search').value.trim().toLowerCase()
  const visible = entries.filter((item) => {
    let host = ''
    try { host = item.url ? new URL(item.url).hostname : '' } catch {}
    let belongs = item.collectionId === selectedCollection
    let cursor = collections.find((entry) => entry.id === item.collectionId)
    while (selectedCollection && cursor?.parentId) {
      if (cursor.parentId === selectedCollection) { belongs = true; break }
      cursor = collections.find((entry) => entry.id === cursor.parentId)
    }
    return (!selectedCollection || belongs) &&
      (!query || `${item.title} ${host} ${item.type}`.toLowerCase().includes(query))
  })

  if (!visible.length) {
    const empty = document.createElement('p')
    empty.textContent = query ? 'No items match your search.' : 'No saved items in this collection yet.'
    empty.style.color = 'var(--muted)'
    root.append(empty)
    return
  }

  for (const item of visible) {
    const card = document.createElement('article')
    card.className = 'card'
    const top = document.createElement('div')
    top.className = 'card-top'
    const icon = document.createElement('img')
    icon.className = 'favicon'
    icon.alt = ''

    let host = item.type || 'Saved item'
    try {
      if (item.url) {
        const parsed = new URL(item.url)
        host = parsed.hostname
        icon.src = new URL('/favicon.ico', parsed.origin).href
        icon.onerror = () => { icon.removeAttribute('src'); icon.alt = '🔒' }
      }
    } catch {
      icon.alt = '🔒'
    }

    const words = document.createElement('div')
    words.style.minWidth = '0'
    const title = document.createElement('div')
    title.className = 'card-title'
    title.textContent = item.title || 'Saved item'
    const hostLabel = document.createElement('div')
    hostLabel.className = 'host'
    hostLabel.textContent = host
    words.append(title, hostLabel)
    top.append(icon, words)

    const collection = collections.find((entry) => entry.id === item.collectionId)
    const tag = document.createElement('span')
    tag.className = 'tag'
    tag.textContent = collection?.title || item.type || 'Bookmark'

    const actions = document.createElement('div')
    actions.className = 'card-actions'
    if (['password', 'api-key', 'token', 'database', 'ssh', 'wifi', 'custom'].includes(item.type)) {
      const secret = document.createElement('code')
      secret.className = 'masked'
      secret.textContent = 'a9F3x•••••'
      const view = document.createElement('button')
      view.textContent = 'View'
      view.onclick = () => void reveal(item, secret, view)
      actions.append(secret, view)
    } else {
      const spacer = document.createElement('span')
      spacer.className = 'host'
      spacer.textContent = 'Encrypted bookmark'
      const open = document.createElement('button')
      open.className = 'primary'
      open.textContent = 'Open'
      open.disabled = !item.url
      open.addEventListener('click', () => void chrome.tabs.create({ url: item.url }))
      actions.append(spacer, open)
    }
    card.append(top, tag, actions)
    root.append(card)
  }
}

async function reveal(item, secret, button) {
  if (!item.cipher) {
    $('#status').textContent = 'This item is not in the local encrypted cache. Open the Vault website to view it.'
    return
  }
  button.disabled = true
  const result = await send({ type: 'vault-decrypt-capture', cipher: item.cipher })
  if (!result?.ok) {
    $('#status').textContent = result?.error || 'Decryption failed.'
    button.disabled = false
    return
  }

  const value = String(result.capture?.password || result.capture?.username || result.capture?.description || '')
  let tick = 0
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  const symbols = '!@#$%&*+?'
  const render = () => {
    if (!reduced && tick < 12) {
      secret.textContent = Array.from(value, (char, index) => index < tick ? char : symbols[Math.floor(Math.random() * symbols.length)]).join('')
      tick++
      setTimeout(render, 45)
    } else {
      secret.textContent = value
    }
  }
  secret.className = 'secret-value'
  render()
  button.textContent = 'Copy'
  button.disabled = false
  button.onclick = () => void navigator.clipboard.writeText(value).then(() => {
    $('#status').textContent = 'Secret copied to clipboard.'
  }).catch(() => {
    $('#status').textContent = 'Clipboard access was denied.'
  })
  setTimeout(() => {
    secret.className = 'masked'
    secret.textContent = 'a9F3x•••••'
    button.textContent = 'View'
    button.onclick = () => void reveal(item, secret, button)
  }, 10000)
}

function updateConnectionUI(paired) {
  const sidebarIndicator = $('#sidebar-indicator')
  const sidebarText = $('#sidebar-status-text')
  const settingsIndicator = $('#settings-status-indicator')
  const settingsLabel = $('#settings-connection-label')
  const disconnectBtn = $('#settings-disconnect-btn')
  const pairingCard = $('#pairing-card')
  const itemsSection = $('#items')

  if (paired) {
    sidebarIndicator.className = 'status-dot connected'
    sidebarText.textContent = 'Connected'
    settingsIndicator.className = 'status-dot connected'
    settingsLabel.textContent = 'Connected to Vault'
    disconnectBtn.hidden = false
    pairingCard.hidden = true
    itemsSection.hidden = false
  } else {
    sidebarIndicator.className = 'status-dot unpaired'
    sidebarText.textContent = 'Not paired'
    settingsIndicator.className = 'status-dot unpaired'
    settingsLabel.textContent = 'Not connected'
    disconnectBtn.hidden = true
    pairingCard.hidden = false
    itemsSection.hidden = true
    entries = []
    collections = []
    renderCollections()
  }
}

async function connectKey(keyInput, messageBox) {
  const rawKey = keyInput.value.trim()
  if (!rawKey) {
    if (messageBox) {
      messageBox.className = 'pairing-message error'
      messageBox.textContent = 'Please paste or enter your pairing key.'
      messageBox.hidden = false
    }
    return
  }

  if (messageBox) {
    messageBox.className = 'pairing-message'
    messageBox.textContent = 'Connecting extension…'
    messageBox.hidden = false
  }

  const result = await send({ type: 'vault-pair', key: rawKey })
  if (result?.ok) {
    keyInput.value = ''
    if (messageBox) {
      messageBox.className = 'pairing-message success'
      messageBox.textContent = 'Extension connected successfully!'
      setTimeout(() => { messageBox.hidden = true }, 4000)
    }
    $('#status').textContent = 'Connected. Syncing bookmarks and collections…'
    await refresh()
  } else {
    if (messageBox) {
      messageBox.className = 'pairing-message error'
      messageBox.textContent = result?.error || 'Unable to connect with this key.'
      messageBox.hidden = false
    }
  }
}

async function refresh() {
  const settings = await send({ type: 'vault-settings' })
  if (settings?.apiOrigin) currentApiOrigin = settings.apiOrigin
  const paired = Boolean(settings?.paired)
  updateConnectionUI(paired)

  if (!paired) {
    $('#status').textContent = 'Extension is not connected. Enter your pairing key below to connect.'
    document.body.classList.add('ready')
    return
  }

  const snapshot = await send({ type: 'vault-fetch-collections' })
  const local = await chrome.storage.local.get('recentItems')
  if (!snapshot?.ok) {
    $('#status').textContent = snapshot?.error || 'Unable to fetch collections from the Vault API.'
    collections = []
    entries = local.recentItems || []
    renderCollections()
    renderItems()
    document.body.classList.add('ready')
    return
  }

  collections = snapshot.collections || []
  const bookmarks = snapshot.bookmarks || []
  const recent = local.recentItems || []
  const remaining = recent.filter((item) => !(item.type === 'bookmark' && bookmarks.some((saved) => saved.url === item.url)))
  if (remaining.length !== recent.length) await chrome.storage.local.set({ recentItems: remaining })
  entries = [...bookmarks, ...remaining.filter((item) => !bookmarks.some((saved) => saved.url && saved.url === item.url))]
  renderCollections()
  renderItems()
  $('#status').textContent = snapshot.stale
    ? `Showing cached data. ${snapshot.error}`
    : `${entries.length} items shown. Bookmarks sync after pending captures are imported into Vault.`
  document.body.classList.add('ready')
}

async function applySettings() {
  const saved = await chrome.storage.local.get(['theme', 'effect', 'duration', 'reduceMotion', 'apiOrigin'])
  if (saved.apiOrigin) currentApiOrigin = saved.apiOrigin
  const theme = themes.includes(saved.theme) ? saved.theme : 'default'
  document.documentElement.dataset.theme = theme
  renderThemeButtons(theme)
  $('#effect-select').value = saved.effect || 'particles'
  $('#duration').value = String(saved.duration || 2)
  $('#duration-value').value = `${saved.duration || 2}s`
  $('#reduce-motion').checked = Boolean(saved.reduceMotion)
}

function closeSettings() {
  $('#settings-panel').hidden = true
  $('#settings-backdrop').hidden = true
}

function openSettings() {
  $('#settings-panel').hidden = false
  $('#settings-backdrop').hidden = false
}

// Modal controls
$('#settings-open').addEventListener('click', openSettings)
$('#settings-close').addEventListener('click', closeSettings)
$('#settings-backdrop').addEventListener('click', closeSettings)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#settings-panel').hidden) closeSettings()
})

// Search & layout controls
$('#search').addEventListener('input', renderItems)
$('.nav[data-collection=""]').addEventListener('click', () => {
  selectedCollection = ''
  renderCollections()
  renderItems()
})
$('#grid-toggle').addEventListener('click', () => {
  layout = 'grid'
  $('#grid-toggle').setAttribute('aria-pressed', 'true')
  $('#list-toggle').setAttribute('aria-pressed', 'false')
  renderItems()
})
$('#list-toggle').addEventListener('click', () => {
  layout = 'list'
  $('#grid-toggle').setAttribute('aria-pressed', 'false')
  $('#list-toggle').setAttribute('aria-pressed', 'true')
  renderItems()
})
$('#refresh').addEventListener('click', () => void refresh())

// New Collection actions
$('#dashboard-new-col-btn')?.addEventListener('click', () => {
  $('#dashboard-new-col-row').hidden = false
  $('#dashboard-new-col-input').focus()
})
$('#dashboard-new-col-cancel')?.addEventListener('click', () => {
  $('#dashboard-new-col-row').hidden = true
  $('#dashboard-new-col-input').value = ''
})
$('#dashboard-new-col-add')?.addEventListener('click', async () => {
  const name = $('#dashboard-new-col-input').value.trim()
  if (!name) return
  $('#status').textContent = 'Creating collection…'
  const res = await send({ type: 'vault-create-collection', title: name })
  if (res?.ok && res.collection) {
    $('#dashboard-new-col-row').hidden = true
    $('#dashboard-new-col-input').value = ''
    $('#status').textContent = `Collection "${res.collection.title}" created.`
    await refresh()
  } else {
    $('#status').textContent = res?.error || 'Unable to create collection.'
  }
})
$('#dashboard-new-col-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#dashboard-new-col-add')?.click() }
  if (e.key === 'Escape') { $('#dashboard-new-col-row').hidden = true }
})

// Effect preferences
$('#effect-select').addEventListener('change', () => void chrome.storage.local.set({ effect: $('#effect-select').value }))
$('#duration').addEventListener('input', () => {
  $('#duration-value').value = `${$('#duration').value}s`
  void chrome.storage.local.set({ duration: Number($('#duration').value) })
})
$('#reduce-motion').addEventListener('change', () => void chrome.storage.local.set({ reduceMotion: $('#reduce-motion').checked }))

// Pairing actions - Main card
$('#pairing-connect-btn').addEventListener('click', () => void connectKey($('#pairing-key-input'), $('#pairing-message')))
$('#pairing-key-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void connectKey($('#pairing-key-input'), $('#pairing-message'))
})
$('#pairing-paste-btn').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText()
    if (text) {
      $('#pairing-key-input').value = text.trim()
      void connectKey($('#pairing-key-input'), $('#pairing-message'))
    }
  } catch {
    $('#pairing-message').className = 'pairing-message error'
    $('#pairing-message').textContent = 'Clipboard permission denied. Please paste the key directly with Ctrl+V.'
    $('#pairing-message').hidden = false
  }
})
$('#open-vault-btn').addEventListener('click', openVaultSettings)

// Pairing actions - Settings panel
$('#settings-connect-btn').addEventListener('click', () => void connectKey($('#settings-key-input'), $('#settings-pairing-message')))
$('#settings-key-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void connectKey($('#settings-key-input'), $('#settings-pairing-message'))
})
$('#settings-disconnect-btn').addEventListener('click', async () => {
  await send({ type: 'vault-unpair' })
  $('#status').textContent = 'Extension disconnected.'
  await refresh()
})
$('#settings-open-vault-btn').addEventListener('click', openVaultSettings)

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  if (changes.theme) {
    document.documentElement.dataset.theme = changes.theme.newValue || 'default'
    renderThemeButtons(changes.theme.newValue || 'default')
  }
  if (['theme', 'recentItems', 'snapshotCache', 'pairingKey'].some((key) => changes[key])) {
    if (!refreshPending) {
      refreshPending = true
      setTimeout(() => {
        refreshPending = false
        void refresh()
      }, 50)
    }
  }
  if (changes.effect) $('#effect-select').value = changes.effect.newValue || 'particles'
  if (changes.duration) {
    $('#duration').value = String(changes.duration.newValue || 2)
    $('#duration-value').value = `${changes.duration.newValue || 2}s`
  }
  if (changes.reduceMotion) $('#reduce-motion').checked = Boolean(changes.reduceMotion.newValue)
})

void applySettings().then(refresh)
