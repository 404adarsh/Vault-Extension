(() => {
  let theme = 'default'
  let preferences = { effect: 'particles', duration: 2, reduceMotion: false }
  let dialogHost = null
  let toastHost = null
  let overlayHost = null
  let promptHost = null
  let dialogPendingId = null
  let dialogEscapeHandler = null
  let animationPromises = new WeakMap()
  let animations = new WeakMap()
  let lastCredentialCaptureAt = 0
  let lastTypedUsername = ''

  const loadPrefs = async () => {
    const saved = await chrome.storage.local.get(['theme', 'effect', 'duration', 'reduceMotion'])
    theme = saved.theme || 'default'
    preferences = { effect: saved.effect || 'particles', duration: Number(saved.duration) || 2, reduceMotion: Boolean(saved.reduceMotion) }
  }
  void loadPrefs()
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    if (changes.theme) theme = changes.theme.newValue || 'default'
    for (const key of ['effect', 'duration', 'reduceMotion']) if (changes[key]) preferences[key] = changes[key].newValue
    for (const host of [dialogHost, toastHost, overlayHost, promptHost]) if (host) host.dataset.theme = theme
  })

  function validWebUrl(value) {
    try { const parsed = new URL(value, location.href); return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : '' } catch { return '' }
  }
  function hostWithStyle(className, fullScreen = false, topRight = false) {
    const host = document.createElement('div')
    host.dataset.theme = theme
    host.style.cssText = fullScreen
      ? 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none'
      : topRight
        ? 'all:initial;position:fixed;z-index:2147483647;right:18px;top:18px;pointer-events:auto'
        : 'all:initial;position:fixed;z-index:2147483647;right:18px;bottom:18px;pointer-events:auto'
    const shadow = host.attachShadow({ mode: 'closed' })
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = chrome.runtime.getURL('content-ui.css')
    shadow.append(link)
    document.documentElement.append(host)
    return { host, shadow, className }
  }
  function disposeAnimation(canvas) { if (!canvas) return; animations.get(canvas)?.dispose(); animations.delete(canvas) }
  function setThreeState(canvas, state) {
    canvas.dataset.state = state
    const present = animations.get(canvas); if (present) { present.setState(state); return }
    let pending = animationPromises.get(canvas)
    if (!pending) {
      pending = import(chrome.runtime.getURL('vendor/three-animation.js')).then(({ createSaveAnimation }) => {
        if (!canvas.isConnected) return
        const animation = createSaveAnimation(canvas); animations.set(canvas, animation); animation.setState(canvas.dataset.state)
      }).catch(() => { canvas.dataset.fallback = state }).finally(() => animationPromises.delete(canvas))
      animationPromises.set(canvas, pending)
    }
  }
  async function playOverlay(effect = preferences.effect) {
    if (theme === 'cyber') effect = 'matrix'
    overlayHost?.remove()
    const { host, shadow } = hostWithStyle('overlay', true); overlayHost = host
    const box = document.createElement('div'); box.className = 'overlay'
    const text = document.createElement('div'); text.className = 'overlay-text'; text.textContent = ''
    box.append(text); shadow.append(box)
    const duration = theme === 'cyber' ? 2.5 : Math.max(2, Math.min(3, Number(preferences.duration) || 2))
    if (effect === 'three') {
      const canvas = document.createElement('canvas'); canvas.width = 140; canvas.height = 140; canvas.style.cssText='position:absolute;left:calc(50% - 50px);top:calc(50% - 110px);width:100px;height:100px'; box.append(canvas); setThreeState(canvas, 'success')
      window.setTimeout(() => disposeAnimation(canvas), duration * 1000)
    } else {
      try { const { playEffect } = await import(chrome.runtime.getURL('effects.js')); playEffect(box, effect, { duration, theme, reduceMotion: preferences.reduceMotion, text: '' }) } catch {}
    }
    if (theme === 'cyber') {
      const phrase = 'ENCRYPTING... ACCESS GRANTED'; let i = 0
      const ticker = window.setInterval(() => { text.textContent = phrase.slice(0, i++); if (i > phrase.length) clearInterval(ticker) }, 55)
      window.setTimeout(() => clearInterval(ticker), duration * 1000)
    } else text.textContent = 'SAVED SECURELY'
    window.setTimeout(() => { if (overlayHost === host) { host.remove(); overlayHost = null } }, duration * 1000)
  }
  function closeDialog() {
    dialogHost?.remove(); dialogHost = null
    if (dialogPendingId) void chrome.runtime.sendMessage({ type: 'vault-clear-pending-capture', id: dialogPendingId }).catch(() => undefined)
    dialogPendingId = null
    if (dialogEscapeHandler) document.removeEventListener('keydown', dialogEscapeHandler, true)
    dialogEscapeHandler = null
  }
  function showToast(message, error = false) {
    toastHost?.remove()
    const { host, shadow } = hostWithStyle('toast'); toastHost = host
    const wrap = document.createElement('div'); wrap.className = 'toast-host'
    const toast = document.createElement('div'); toast.className = 'toast'; toast.setAttribute('role', error ? 'alert' : 'status'); toast.textContent = message
    if (error) toast.style.borderColor = 'var(--danger)'
    wrap.append(toast); shadow.append(wrap)
    window.setTimeout(() => { if (toastHost === host) { host.remove(); toastHost = null } }, error ? 5000 : 2800)
  }

  function closePrompt() {
    promptHost?.remove()
    promptHost = null
  }

  function showPasswordSavePrompt(capture, pendingId = null) {
    if (!capture || !capture.password) return
    closePrompt()
    const { host, shadow } = hostWithStyle('save-prompt-host', false, true)
    promptHost = host

    const box = document.createElement('div')
    box.className = 'save-prompt'

    const head = document.createElement('div')
    head.className = 'prompt-head'

    const logo = document.createElement('img')
    logo.src = chrome.runtime.getURL('icons/favicon-32.png')
    logo.alt = ''

    const heading = document.createElement('h3')
    heading.textContent = 'Save password to Vault?'

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'prompt-close'
    closeBtn.textContent = '×'
    closeBtn.setAttribute('aria-label', 'Dismiss')
    closeBtn.addEventListener('click', () => {
      if (pendingId) void chrome.runtime.sendMessage({ type: 'vault-clear-pending-capture', id: pendingId })
      closePrompt()
    })

    head.append(logo, heading, closeBtn)

    const subtitle = document.createElement('p')
    subtitle.className = 'hint'
    subtitle.style.margin = '0 0 10px 0'
    const hostname = (() => { try { return new URL(capture.url).hostname } catch { return location.hostname } })()
    subtitle.textContent = `Save this login for ${hostname}?`

    const fields = document.createElement('div')
    fields.className = 'prompt-fields'

    const userLabel = document.createElement('label')
    userLabel.textContent = 'Username / Email'
    const userInput = document.createElement('input')
    userInput.type = 'text'
    userInput.value = capture.username || ''
    userInput.placeholder = 'Username or email'
    userLabel.append(userInput)

    const passLabel = document.createElement('label')
    passLabel.textContent = 'Password'
    const passInput = document.createElement('input')
    passInput.type = 'password'
    passInput.value = capture.password || ''
    passLabel.append(passInput)

    const collectionLabel = document.createElement('label')
    collectionLabel.textContent = 'Collection'
    const collectionSelect = document.createElement('select')
    collectionSelect.append(new Option('No collection', ''))
    collectionLabel.append(collectionSelect)
    fields.append(userLabel, passLabel, collectionLabel)
    void loadCollections().then((snapshot) => {
      if (!snapshot?.ok) return
      const byId = new Map((snapshot.collections || []).map((entry) => [entry.id, entry]))
      const pathFor = (entry) => entry.parentId && byId.has(entry.parentId) ? `${pathFor(byId.get(entry.parentId))} / ${entry.title}` : entry.title
      for (const entry of snapshot.collections || []) collectionSelect.add(new Option(pathFor(entry), entry.id))
    }).catch(() => undefined)

    const actions = document.createElement('div')
    actions.className = 'prompt-actions'

    const saveBtn = document.createElement('button')
    saveBtn.type = 'button'
    saveBtn.className = 'primary'
    saveBtn.textContent = 'Save'
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true
      saveBtn.textContent = 'Saving…'
      void playOverlay(preferences.effect)
      const toSave = {
        ...capture,
        username: userInput.value.trim(),
        password: passInput.value,
        collectionId: collectionSelect.value || null,
      }
      const res = await chrome.runtime.sendMessage({ type: 'vault-save-capture', capture: toSave, pendingId })
      closePrompt()
      if (res?.ok) {
        showToast('Password saved to Markanm Vault.')
      } else {
        showToast(res?.error || 'Unable to save password.', true)
      }
    })

    const notNowBtn = document.createElement('button')
    notNowBtn.type = 'button'
    notNowBtn.textContent = 'Not now'
    notNowBtn.addEventListener('click', () => {
      if (pendingId) void chrome.runtime.sendMessage({ type: 'vault-clear-pending-capture', id: pendingId })
      closePrompt()
    })

    actions.append(saveBtn, notNowBtn)

    const editBtn = document.createElement('button')
    editBtn.type = 'button'
    editBtn.className = 'prompt-edit'
    editBtn.textContent = 'Edit details or choose collection'
    editBtn.addEventListener('click', () => {
      closePrompt()
      void openSaveDialog(capture.url, capture.title, {
        passwordCapture: { ...capture, username: userInput.value.trim(), password: passInput.value },
        pendingId
      })
    })

    box.append(head, subtitle, fields, actions, editBtn)
    shadow.append(box)
  }

  // Keep track of any typed username across the page (for multi-step logins)
  document.addEventListener('input', (event) => {
    const t = event.target
    if (!(t instanceof HTMLInputElement) || t.type === 'password' || t.type === 'hidden') return
    if (/user|email|login|account|phone/i.test(`${t.name} ${t.id} ${t.autocomplete} ${t.type} ${t.placeholder || ''}`)) {
      if (t.value.trim()) lastTypedUsername = t.value.trim()
    }
  }, { passive: true, capture: true })

  function captureFrom(context) {
    const root = context instanceof Element ? context : document
    let passwordInput = null
    const passwords = [...root.querySelectorAll('input[type="password"], input[autocomplete="current-password"]')].filter((input) => input.value && !input.disabled && input.getClientRects().length > 0)
    if (passwords.length > 0) {
      passwordInput = passwords[0]
    } else {
      const docPasswords = [...document.querySelectorAll('input[type="password"], input[autocomplete="current-password"]')].filter((input) => input.value && !input.disabled && input.getClientRects().length > 0)
      if (docPasswords.length > 0) passwordInput = docPasswords[0]
    }
    if (!passwordInput?.value) return null

    // Search scopes for username: form first, then parent container, then document body
    const searchScopes = [
      passwordInput.closest('form, [role="form"]'),
      root !== document ? root : null,
      passwordInput.parentElement?.parentElement,
      document.body
    ].filter(Boolean)

    let username = lastTypedUsername
    for (const scope of searchScopes) {
      const fields = [...scope.querySelectorAll('input:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"])')].filter((input) => input.value && !input.disabled)
      const matched = fields.find((input) => /user|email|login|account|identifier/i.test(`${input.name} ${input.id} ${input.autocomplete} ${input.type} ${input.placeholder || ''}`))
      if (matched?.value?.trim()) {
        username = matched.value.trim()
        break
      }
      if (!username && fields.length > 0) {
        const prior = fields.find((input) => (passwordInput.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_PRECEDING)) || fields[0]
        if (prior?.value?.trim()) {
          username = prior.value.trim()
          break
        }
      }
    }

    return {
      type: 'password',
      title: document.title.trim().slice(0, 160) || location.hostname,
      description: '',
      url: location.href,
      username: (username || '').slice(0, 255),
      password: passwordInput.value,
      collectionId: null,
      fields: []
    }
  }
  async function loadCollections() { return chrome.runtime.sendMessage({ type:'vault-fetch-collections' }) }

  async function openSaveDialog(rawUrl, suggestedTitle = '', options = {}) {
    const url = validWebUrl(rawUrl); if (!url) { showToast('Only regular web pages and image URLs can be saved.', true); return }
    closeDialog()
    dialogPendingId = options.pendingId || null
    const { host, shadow } = hostWithStyle('dialog'); dialogHost = host
    const dialog = document.createElement('section'); dialog.className = 'dialog'; dialog.setAttribute('role','dialog'); dialog.setAttribute('aria-modal','true'); dialog.setAttribute('aria-label','Save to Markanm Vault')
    const heading = document.createElement('h2'); heading.className = 'heading';
    const logo = document.createElement('img'); logo.src = chrome.runtime.getURL('icons/favicon-32.png'); logo.alt=''
    const titleText = document.createElement('span'); titleText.textContent = 'Save to Markanm Vault'; heading.append(logo,titleText)
    const close = document.createElement('button'); close.type='button'; close.className='close'; close.textContent='×'; close.setAttribute('aria-label','Close save dialog'); close.addEventListener('click',closeDialog); heading.append(close)
    const hint = document.createElement('p'); hint.className='hint'; hint.textContent = new URL(url).hostname
    const form = document.createElement('form'); form.className='form'
    const field = (name, labelText, input, required = false) => { const label=document.createElement('label'); label.textContent=labelText; input.name=name; input.required=required; label.append(input); return label }
    const title = document.createElement('input'); title.maxLength=160; title.value=(suggestedTitle || document.title || new URL(url).hostname).trim().slice(0,160)
    const kind = document.createElement('select')
    const types = [['bookmark','Website / link'],['password','Password'],['api-key','API key'],['token','Token'],['database','Database'],['ssh','SSH key'],['wifi','Wi-Fi'],['note','Secure note'],['custom','Custom']]
    for (const [value,label] of types) kind.add(new Option(label,value))
    kind.value = options.passwordCapture ? 'password' : options.selectionText ? 'note' : 'bookmark'
    const collection = document.createElement('select'); collection.add(new Option('No collection',''))
    const collectionWrap = document.createElement('div')
    collectionWrap.style.cssText = 'display:grid;gap:5px;'
    const colHeader = document.createElement('div')
    colHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:center;'
    const colLabel = document.createElement('span')
    colLabel.textContent = 'Collection'
    colLabel.style.cssText = 'color:var(--muted);font-size:11px;'
    const newColBtn = document.createElement('button')
    newColBtn.type = 'button'
    newColBtn.textContent = '+ New collection'
    newColBtn.style.cssText = 'background:none;border:none;color:var(--accent);font-size:11px;cursor:pointer;padding:0;min-height:unset;'
    colHeader.append(colLabel, newColBtn)

    const newColRow = document.createElement('div')
    newColRow.hidden = true
    newColRow.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:2px;'
    const newColInput = document.createElement('input')
    newColInput.type = 'text'
    newColInput.placeholder = 'Collection name'
    newColInput.maxLength = 160
    newColInput.style.cssText = 'flex:1;padding:6px 10px;font-size:12px;'
    const newColAdd = document.createElement('button')
    newColAdd.type = 'button'
    newColAdd.className = 'primary'
    newColAdd.textContent = 'Create'
    newColAdd.style.cssText = 'padding:6px 10px;font-size:11px;min-height:unset;'
    const newColCancel = document.createElement('button')
    newColCancel.type = 'button'
    newColCancel.textContent = '✕'
    newColCancel.style.cssText = 'padding:6px 8px;font-size:11px;min-height:unset;'
    newColRow.append(newColInput, newColAdd, newColCancel)

    newColBtn.addEventListener('click', () => { newColRow.hidden = false; newColBtn.hidden = true; newColInput.focus() })
    newColCancel.addEventListener('click', () => { newColRow.hidden = true; newColBtn.hidden = false; newColInput.value = '' })
    const doCreateCol = async () => {
      const name = newColInput.value.trim()
      if (!name) return
      newColAdd.disabled = true; newColAdd.textContent = '…'
      const res = await chrome.runtime.sendMessage({ type: 'vault-create-collection', title: name })
      newColAdd.disabled = false; newColAdd.textContent = 'Create'
      if (res?.ok && res.collection) {
        collection.add(new Option(res.collection.title, res.collection.id))
        collection.value = res.collection.id
        newColRow.hidden = true; newColBtn.hidden = false; newColInput.value = ''
        status.textContent = `Collection "${res.collection.title}" created!`
      } else {
        status.textContent = res?.error || 'Unable to create collection.'
      }
    }
    newColAdd.addEventListener('click', () => void doCreateCol())
    newColInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); void doCreateCol() }
      if (e.key === 'Escape') { newColRow.hidden = true; newColBtn.hidden = false; newColInput.value = '' }
    })
    collectionWrap.append(colHeader, collection, newColRow)

    const description = document.createElement('textarea'); description.rows=2; description.maxLength=4000; description.placeholder='Add a note or description'
    if (options.selectionText) description.value=options.selectionText.slice(0,4000)
    const username = document.createElement('input'); username.autocomplete='off'; username.maxLength=255; username.placeholder='Username or identifier'
    const secret = document.createElement('input'); secret.type='password'; secret.autocomplete='off'; secret.maxLength=10000; secret.placeholder='Password or secret'
    if (options.passwordCapture) { username.value=options.passwordCapture.username||''; secret.value=options.passwordCapture.password||'' }
    const secretField=field('secret','Secret value',secret)
    const userField=field('username','Username / identifier',username)
    const requiredLabel=document.createElement('span'); requiredLabel.className='hint';
    kind.addEventListener('change',()=>{ const needs=kind.value!=='bookmark'&&kind.value!=='note'; secretField.hidden=!needs; userField.hidden=!needs; secret.required=needs; if(!needs){secret.value='';username.value=''} })
    kind.dispatchEvent(new Event('change'))
    const status=document.createElement('p'); status.className='status'; status.setAttribute('role','status'); status.textContent='Loading your collections...'
    const actions=document.createElement('div'); actions.className='actions'
    const save=document.createElement('button'); save.type='submit'; save.className='primary'; save.textContent='Save item'; save.disabled=true
    const cancel=document.createElement('button'); cancel.type='button'; cancel.textContent='Cancel'; cancel.addEventListener('click',closeDialog)
    form.append(field('title','Title',title,true),field('type','Type',kind),collectionWrap,field('description','Description',description),userField,secretField)
    actions.append(save,cancel); form.append(actions); dialog.append(heading,hint,form,status); shadow.append(dialog)
    dialog.addEventListener('click',(event)=>{if(event.target===dialog)closeDialog()})
    dialogEscapeHandler=(event)=>{if(event.key==='Escape'&&dialogHost===host)closeDialog()}
    document.addEventListener('keydown',dialogEscapeHandler,true)
    const items=await loadCollections()
    if (!host.isConnected) return
    save.disabled = false
    if (!items?.ok) {
      status.textContent=items?.error || 'Unable to load collections. You can still save or pair in Vault settings.'
    } else {
      const byId=new Map((items.collections||[]).map((entry)=>[entry.id,entry]))
      const pathFor=(entry)=>entry.parentId&&byId.has(entry.parentId)?`${pathFor(byId.get(entry.parentId))} / ${entry.title}`:entry.title
      for(const entry of items.collections || []) collection.add(new Option(pathFor(entry),entry.id))
      status.textContent=items.stale?`Using cached collections. ${items.error}`:'Choose a type and collection, then save.'
    }
    form.addEventListener('submit',async(event)=>{
      event.preventDefault(); if(save.disabled)return
      const type=kind.value; if(type!=='bookmark'&&type!=='note'&&!secret.value){status.textContent='Enter a secret value before saving.';return}
      save.disabled=true; status.textContent='Encrypting and saving...'; void playOverlay(preferences.effect)
      const capture={ type,title:title.value.trim()||new URL(url).hostname,description:description.value.trim(),url,username:username.value.trim(),password:secret.value,collectionId:collection.value||null,fields:[] }
      const result=await chrome.runtime.sendMessage({type:'vault-save-capture',capture,pendingId:dialogPendingId})
      if(!result?.ok){status.textContent=result?.error||'Unable to save. Check the extension pairing.';save.disabled=false;return}
      closeDialog(); showToast('Saved to Markanm Vault.');
    })
    title.focus()
  }

  chrome.runtime.onMessage.addListener((message)=>{
    if(message?.type==='vault-open-bookmark') {
      const selected=message.selectionText || ''
      void playOverlay('scanlines')
      void openSaveDialog(message.url,message.title||'',{selectionText:selected,isImage:message.isImage})
    }
    if(message?.type==='vault-auto-save-progress') {
      if(message.phase==='saving') { void playOverlay(preferences.effect); showToast('Encrypting login for Markanm Vault...') }
      else if(message.phase==='done') showToast(`${message.title||'Login'} saved securely.`)
      else showToast(message.error||'Unable to save this login.',true)
    }
  })
  function isVaultPage(){return ['vault.markanm.com','localhost','127.0.0.1','::1'].includes(location.hostname.toLowerCase())}
  if (isVaultPage()) {
    const announceStatus = async () => {
      try {
        const settings = await chrome.runtime.sendMessage({ type: 'vault-settings' })
        window.dispatchEvent(new CustomEvent('markanm-vault-extension-ready', {
          detail: { installed: true, paired: Boolean(settings?.paired) }
        }))
      } catch {}
    }
    window.addEventListener('markanm-vault-ping-extension', announceStatus)
    window.addEventListener('markanm-vault-pair-extension', async (event) => {
      const key = event.detail?.key
      if (!key) return
      try {
        const result = await chrome.runtime.sendMessage({ type: 'vault-pair', key })
        window.dispatchEvent(new CustomEvent('markanm-vault-pair-result', { detail: result }))
        if (result?.ok) showToast('Markanm Vault extension connected successfully!')
      } catch (err) {
        window.dispatchEvent(new CustomEvent('markanm-vault-pair-result', { detail: { ok: false, error: String(err) } }))
      }
    })
    void announceStatus()
    setTimeout(announceStatus, 600)
  }
  if (!isVaultPage()) {
    // Navigation can finish before the worker has staged the encrypted
    // capture from the submit event. Retry briefly so the new document does
    // not miss the prompt on fast login redirects.
    void (async () => {
      for (const delay of [0, 250, 700]) {
        if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay))
        const result = await chrome.runtime.sendMessage({ type: 'vault-get-pending-capture', hostname: location.hostname }).catch(() => null)
        if (result?.ok && result.capture) {
          showPasswordSavePrompt(result.capture, result.id)
          return
        }
      }
    })()
  }

  function handleCredentialIntent(target) {
    if (isVaultPage() || Date.now() - lastCredentialCaptureAt < 10_000) return
    const capture = captureFrom(target)
    if (!capture) return
    lastCredentialCaptureAt = Date.now()
    void chrome.runtime.sendMessage({ type: 'vault-detected-capture', capture }).then((result) => {
      if (result?.mode === 'saved') return
      if (result?.mode === 'unpaired') {
        showToast('Pair Markanm Vault from the extension popup before saving logins.', true)
        return
      }
      if (result?.mode === 'error') {
        showToast(result.error || 'Automatic save failed.', true)
        return
      }
      if (result?.ok) {
        showPasswordSavePrompt(capture, result.pendingId)
      }
    }).catch(() => undefined)
  }

  document.addEventListener('submit', (event) => handleCredentialIntent(event.target), true)

  document.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const control = target.closest('button, input[type="submit"], input[type="button"], [role="button"], a[role="button"]')
    if (control && (control.matches('input[type="submit"]') || control.getAttribute('type') === 'submit' || /sign\s*in|log\s*in|login|authenticate|submit|continue/.test(`${control.innerText || control.value || ''} ${control.getAttribute('aria-label') || ''}`.toLowerCase()))) {
      handleCredentialIntent(control)
    }
  }, true)

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    const target = event.target
    if (target instanceof HTMLInputElement) {
      handleCredentialIntent(target)
    }
  }, true)

  window.addEventListener('pagehide', () => {
    if (isVaultPage()) return
    const capture = captureFrom(document)
    if (capture && capture.password) {
      void chrome.runtime.sendMessage({ type: 'vault-detected-capture', capture }).catch(() => undefined)
    }
  }, { capture: true })
})()
