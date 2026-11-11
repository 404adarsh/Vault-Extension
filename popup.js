const $ = (selector) => document.querySelector(selector)
const themeNames = ['default','cyber','developer','designer','student','finance','gamer']
const themePicker = $('#theme-picker')
const status = $('#status')
const quickForm = $('#quick-form')
const keyInput = $('#key')
const pairButton = $('#pair')
const disconnectButton = $('#disconnect')
const alwaysInput = $('#always')
const saveAnimationWrap = $('#save-animation-wrap')
let savedBookmarks = []
let savedCollections = []
let saveAnimation = null
let animationModulePromise
let refreshQueued = false
let animationTimer = 0

function send(message) { return chrome.runtime.sendMessage(message) }
function themeAccent(name) { const current=document.documentElement.dataset.theme;document.documentElement.dataset.theme=name;const accent=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();document.documentElement.dataset.theme=current||'default';return accent }
function renderThemes(selected) {
  themePicker.replaceChildren()
  for (const name of themeNames) {
    const button = document.createElement('button'); button.type='button'; button.className='theme-swatch'; button.style.setProperty('--swatch',themeAccent(name)); button.title=name[0].toUpperCase()+name.slice(1); button.setAttribute('aria-label',`Use ${name} theme`); button.setAttribute('aria-pressed',String(name===selected)); button.addEventListener('click',()=>void setTheme(name)); themePicker.append(button)
  }
}
async function setTheme(name) { document.documentElement.dataset.theme=name; await chrome.storage.local.set({theme:name}); renderThemes(name) }
async function applyPreferences() {
  const saved=await chrome.storage.local.get(['theme','effect','duration','reduceMotion'])
  const theme=themeNames.includes(saved.theme)?saved.theme:'default'
  document.documentElement.dataset.theme=theme; renderThemes(theme)
  $('#effect-select').value=saved.effect||'particles'; $('#duration').value=String(saved.duration||2); $('#duration-value').value=`${saved.duration||2}s`; $('#reduce-motion').checked=Boolean(saved.reduceMotion)
  document.body.classList.add('ready')
}
async function setSaveAnimationState(state) {
  saveAnimationWrap.hidden=false
  try { animationModulePromise ||= import('./vendor/three-animation.js'); if(!saveAnimation){const {createSaveAnimation}=await animationModulePromise;saveAnimation=createSaveAnimation($('#save-animation'))}saveAnimation.setState(state) }
  catch { saveAnimationWrap.dataset.fallback=state }
}
async function playSelectedEffect() {
  const saved=await chrome.storage.local.get(['effect','duration','theme','reduceMotion'])
  const selected=saved.effect||'particles'
  saveAnimationWrap.dataset.effect=selected
  if(selected==='three'){saveAnimationWrap.hidden=false;clearTimeout(animationTimer);await setSaveAnimationState('saving');return 'three'}
  if(selected==='none')return 'none'
  saveAnimationWrap.hidden=false
  try { const {playEffect}=await import('./effects.js');playEffect(saveAnimationWrap,selected,{duration:saved.duration||2,theme:saved.theme||'default',reduceMotion:Boolean(saved.reduceMotion)});setTimeout(()=>{saveAnimationWrap.hidden=true},Math.max(1000,Number(saved.duration||2)*1000));return selected } catch { saveAnimationWrap.hidden=true;return 'none' }
}
window.addEventListener('pagehide',()=>saveAnimation?.dispose())

function mergeLocalItems(snapshot, recentItems) {
  const serverBookmarks=snapshot.bookmarks||[]
  const remaining=[]
  for(const item of recentItems){
    const inServer=item.type==='bookmark'&&serverBookmarks.some((saved)=>saved.url===item.url)
    if(!inServer)remaining.push(item)
  }
  const merged=[...serverBookmarks,...remaining.filter((item)=>!serverBookmarks.some((saved)=>saved.url&&saved.url===item.url))]
  return {merged,remaining}
}
let popupApiOrigin = 'https://vault.markanm.com'

async function refresh() {
  const settings=await send({type:'vault-settings'})
  if (settings?.apiOrigin) popupApiOrigin = settings.apiOrigin
  alwaysInput.checked=Boolean(settings.alwaysSave); disconnectButton.hidden=!settings.paired; pairButton.disabled=false
  $('#bookmarks-panel').hidden=!settings.paired; pairButton.textContent=settings.paired?'Replace pairing key':'Connect extension'
  if(!settings.paired){
    $('#settings').hidden=false
    status.textContent='Create a Vault account or sign in, then pair this extension below or from Vault Settings.'
    document.body.classList.add('ready')
    return
  }
  const result=await send({type:'vault-fetch-collections'})
  const local=await chrome.storage.local.get('recentItems')
  if(!result?.ok){status.textContent=result?.error||'Unable to load Vault collections.';savedCollections=[];savedBookmarks=(local.recentItems||[]);renderBookmarks(savedBookmarks,savedCollections);document.body.classList.add('ready');return}
  const merged=mergeLocalItems(result,local.recentItems||[])
  savedCollections=result.collections||[];savedBookmarks=merged.merged
  if(merged.remaining.length!==(local.recentItems||[]).length)await chrome.storage.local.set({recentItems:merged.remaining})
  const selected=$('#collection').value;$('#collection').replaceChildren(new Option('No collection',''))
  const collectionById=new Map(savedCollections.map((entry)=>[entry.id,entry]))
  const collectionPath=(entry,seen=new Set())=>{if(seen.has(entry.id))return entry.title;seen.add(entry.id);return entry.parentId&&collectionById.has(entry.parentId)?`${collectionPath(collectionById.get(entry.parentId),seen)} / ${entry.title}`:entry.title}
  for(const collection of savedCollections)$('#collection').add(new Option(collectionPath(collection),collection.id))
  if(savedCollections.some((collection)=>collection.id===selected))$('#collection').value=selected
  const filter=$('#bookmark-filter').value;$('#bookmark-filter').replaceChildren(new Option('All collections',''))
  for(const collection of savedCollections)$('#bookmark-filter').add(new Option(collectionPath(collection),collection.id))
  if(savedCollections.some((collection)=>collection.id===filter))$('#bookmark-filter').value=filter
  status.textContent=result.stale?`Using saved collection data (${savedCollections.length} collections). ${result.error}`:`Connected · ${savedCollections.length} collections. Save this page or review recent items.`
  renderBookmarks(savedBookmarks,savedCollections);document.body.classList.add('ready')
}
function renderBookmarks(items,collections) {
  const list=$('#bookmarks');const filter=$('#bookmark-filter').value;list.replaceChildren()
  const visible=items.filter((item)=>!filter||item.collectionId===filter)
  if(!visible.length){const empty=document.createElement('p');empty.className='bookmark-empty';empty.textContent='No recent items in this collection.';list.append(empty);return}
  for(const item of visible.slice(0,15)){
    const row=document.createElement('article');row.className='bookmark-row'
    const details=document.createElement('div');details.className='bookmark-details'
    const title=document.createElement('strong');title.textContent=item.title||'Saved item'
    const meta=document.createElement('small');let host=item.type||'bookmark';try{if(item.url)host=new URL(item.url).hostname}catch{};meta.textContent=host
    details.append(title,meta)
    const collection=collections.find((entry)=>entry.id===item.collectionId);if(collection){const tag=document.createElement('small');tag.textContent=collection.title;details.append(tag)}
    if(item.type==='password'||item.type==='api-key'||item.type==='token'||item.type==='database'||item.type==='ssh'||item.type==='wifi'||item.type==='custom'){
      const secret=document.createElement('code');secret.className='encrypted flicker';secret.textContent='a9F3x•••••';details.append(secret)
      const view=document.createElement('button');view.type='button';view.textContent='View';view.onclick=()=>void viewSecret(item,secret,view);row.append(details,view)
    }else{
      const open=document.createElement('button');open.type='button';open.className='bookmark-open';open.textContent='Open';open.disabled=!item.url;open.addEventListener('click',()=>void chrome.tabs.create({url:item.url}));row.append(details,open)
    }
    list.append(row)
  }
}
async function viewSecret(item,element,button) {
  if(!item.cipher){status.textContent='This encrypted item is no longer available locally. Open Vault to sync it.';return}
  button.disabled=true;element.textContent='••••••••••';
  const result=await send({type:'vault-decrypt-capture',cipher:item.cipher})
  if(!result?.ok){status.textContent=result?.error||'Unable to decrypt this local item.';button.disabled=false;return}
  element.classList.remove('flicker');const realValue=String(result.capture?.password||result.capture?.username||result.capture?.description||'')
  const scramble='!@#$%&*+?';let n=0;const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:650
  const paint=()=>{if(n<duration){element.textContent=Array.from(realValue).map((char,index)=>index<n/25?char:scramble[Math.floor(Math.random()*scramble.length)]).join('');n+=50;setTimeout(paint,50)}else element.textContent=realValue}
  paint();button.textContent='Copy';button.disabled=false
  const copy=async()=>{await navigator.clipboard.writeText(realValue);status.textContent='Copied. The value will hide automatically.'}
  button.onclick=()=>void copy()
  setTimeout(()=>{element.textContent='a9F3x•••••';element.classList.add('flicker');button.textContent='View';button.onclick=()=>void viewSecret(item,element,button)},10000)
}

$('#open-dashboard').addEventListener('click',()=>void chrome.tabs.create({url:chrome.runtime.getURL('dashboard.html')}).then(()=>window.close()))
$('#close-popup').addEventListener('click',()=>window.close())
$('#toggle-quick').addEventListener('click',async()=>{
  quickForm.hidden=!quickForm.hidden
  if(!quickForm.hidden){const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});if(tab?.url?.startsWith('http')){$('#url').value=tab.url;$('#title').value=tab.title||new URL(tab.url).hostname}}
})
$('#toggle-settings').addEventListener('click',()=>{$('#settings').hidden=!$('#settings').hidden})
$('#effect-select').addEventListener('change',()=>void chrome.storage.local.set({effect:$('#effect-select').value}))
$('#duration').addEventListener('input',()=>{$('#duration-value').value=`${$('#duration').value}s`;void chrome.storage.local.set({duration:Number($('#duration').value)})})
$('#reduce-motion').addEventListener('change',()=>void chrome.storage.local.set({reduceMotion:$('#reduce-motion').checked}))
$('#always').addEventListener('change',async()=>{await send({type:'vault-always-save',enabled:alwaysInput.checked});status.textContent=alwaysInput.checked?'Submitted login passwords will be saved automatically.':'You will be asked before each password is saved.'})
$('#popup-new-col-btn')?.addEventListener('click', () => {
  $('#popup-new-col-row').hidden = false
  $('#popup-new-col-input').focus()
})
$('#popup-new-col-cancel')?.addEventListener('click', () => {
  $('#popup-new-col-row').hidden = true
  $('#popup-new-col-input').value = ''
})
$('#popup-new-col-add')?.addEventListener('click', async () => {
  const name = $('#popup-new-col-input').value.trim()
  if (!name) return
  status.textContent = 'Creating collection…'
  const res = await send({ type: 'vault-create-collection', title: name })
  if (res?.ok && res.collection) {
    $('#popup-new-col-row').hidden = true
    $('#popup-new-col-input').value = ''
    status.textContent = `Collection "${res.collection.title}" created.`
    await refresh()
    $('#collection').value = res.collection.id
  } else {
    status.textContent = res?.error || 'Unable to create collection.'
  }
})
$('#popup-new-col-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#popup-new-col-add')?.click() }
  if (e.key === 'Escape') { $('#popup-new-col-row').hidden = true }
})
$('#pair').addEventListener('click',async()=>{const result=await send({type:'vault-pair',key:keyInput.value});status.textContent=result.ok?'Extension connected.':result.error;if(result.ok)keyInput.value='';await refresh()})
$('#paste-key').addEventListener('click',async()=>{
  try {
    const text=await navigator.clipboard.readText()
    if(text) keyInput.value=text.trim()
  } catch {
    status.textContent='Clipboard permission denied. Please paste with Ctrl+V.'
  }
})
$('#popup-open-vault').addEventListener('click',()=>void chrome.tabs.create({url:`${popupApiOrigin}/vault/settings`}).then(()=>window.close()))
$('#disconnect').addEventListener('click',async()=>{await send({type:'vault-unpair'});await refresh()})
quickForm.addEventListener('submit',async(event)=>{
  event.preventDefault();const name=$('#field-name').value.trim();const value=$('#field-value').value
  const capture={type:$('#item-type').value,title:$('#title').value.trim(),description:$('#description').value.trim(),url:$('#url').value.trim(),username:$('#username').value.trim(),password:$('#secret').value,collectionId:$('#collection').value||null,fields:name?[{name,value}]:[]}
  if(capture.type==='bookmark'&&!capture.url){status.textContent='Enter a website URL to save a bookmark.';return}
  if(capture.type!=='bookmark'&&capture.type!=='note'&&!capture.password){status.textContent='Enter a secret value before saving.';return}
  status.textContent='Encrypting and saving...';const effect=await playSelectedEffect()
  const response=await send({type:'vault-save-capture',capture})
  if(response.ok){if(effect==='three'){await setSaveAnimationState('success');const {duration=2}=await chrome.storage.local.get('duration');animationTimer=setTimeout(()=>{saveAnimationWrap.hidden=true},Number(duration)*1000)}status.textContent='Saved securely. Recent items refreshed.';quickForm.reset();quickForm.hidden=true;await refresh()}else{if(effect==='three'){await setSaveAnimationState('error');animationTimer=setTimeout(()=>{saveAnimationWrap.hidden=true},1500)}status.textContent=response.error||'Unable to save.'}
})
$('#bookmark-filter').addEventListener('change',()=>renderBookmarks(savedBookmarks,savedCollections))
$('#refresh-bookmarks').addEventListener('click',()=>void refresh())
chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;if(['recentItems','snapshotCache','customCollections','theme','pairingKey'].some((key)=>changes[key])){if(changes.theme){document.documentElement.dataset.theme=changes.theme.newValue||'default';renderThemes(changes.theme.newValue||'default')}if(!refreshQueued){refreshQueued=true;setTimeout(()=>{refreshQueued=false;void refresh()},50)}}})
void applyPreferences().then(refresh)
