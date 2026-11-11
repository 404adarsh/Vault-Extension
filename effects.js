const reducedBySystem = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export function playEffect(container, name, { duration = 2, theme = 'default', reduceMotion = false, text = '' } = {}) {
  const ms = Math.max(1000, Math.min(5000, Number(duration) * 1000 || 2000))
  const reduce = reduceMotion || reducedBySystem()
  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  canvas.className = 'vault-effect-canvas'
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' })
  container.append(canvas)
  const ctx = canvas.getContext('2d')
  let raf = 0
  let stopped = false
  const resize = () => { const rect = container.getBoundingClientRect(); const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.max(1, rect.width * dpr); canvas.height = Math.max(1, rect.height * dpr); ctx?.setTransform(dpr, 0, 0, dpr, 0, 0) }
  resize()
  const observer = new ResizeObserver(resize)
  observer.observe(container)
  const started = performance.now()
  const accent = getComputedStyle(container).getPropertyValue('--accent').trim() || (theme === 'cyber' ? '#00ff9c' : '#77b2ff')
  const palette = ['--accent','--success','--danger','--muted'].map((name) => getComputedStyle(container).getPropertyValue(name).trim()).filter(Boolean)
  const columns = Math.max(4, Math.floor((canvas.clientWidth || 330) / 13))
  const drops = Array.from({ length: columns }, () => Math.random() * 30)
  function draw(now) {
    if (stopped || !ctx) return
    const width = canvas.clientWidth || container.clientWidth || 330
    const height = canvas.clientHeight || container.clientHeight || 180
    const elapsed = now - started
    ctx.clearRect(0, 0, width, height)
    if (!reduce && name === 'matrix') {
      ctx.fillStyle = accent
      ctx.font = '12px monospace'
      drops.forEach((drop, index) => { ctx.fillText(Math.random() > .5 ? '1' : '0', index * (width / columns), drop * 14); drops[index] = drop * 14 > height && Math.random() > .97 ? 0 : drop + 1 })
    } else if (!reduce && name === 'particles') {
      for (let i = 0; i < 45; i++) { const phase = elapsed / 500 + i * 13.4; const x = (Math.sin(phase) * .5 + .5) * width; const y = ((elapsed * (.02 + i % 5 * .004) + i * 47) % height); ctx.globalAlpha = .25 + (i % 7) / 10; ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(x, y, 1 + i % 3, 0, Math.PI * 2); ctx.fill() }
      ctx.globalAlpha = 1
    } else if (!reduce && name === 'confetti') {
      for (let i = 0; i < 65; i++) { const y = (elapsed * (.15 + i % 4 * .05) + i * 31) % height; const x = (i * 53 + Math.sin(elapsed / 120 + i) * 30) % width; ctx.fillStyle = palette[i % palette.length]; ctx.fillRect(x, y, 5, 8) }
    } else if (!reduce && name === 'scanlines') {
      ctx.fillStyle = `${accent}55`; const y = (elapsed * .35) % height; ctx.fillRect(0, y, width, 3)
    } else if (!reduce && name === 'glitch') {
      for (let i = 0; i < 7; i++) { ctx.globalAlpha = Math.random() * .5; ctx.fillStyle = palette[i % palette.length]; ctx.fillRect(Math.random() * width, Math.random() * height, width * (.08 + Math.random() * .5), 2 + Math.random() * 8) } ctx.globalAlpha = 1
    }
    if (text) { ctx.font = '700 14px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.shadowColor = accent; ctx.shadowBlur = reduce ? 0 : 12; ctx.fillStyle = getComputedStyle(container).getPropertyValue('--text').trim() || '#fff'; ctx.fillText(text, width / 2, height / 2); ctx.shadowBlur = 0 }
    if (elapsed < ms) raf = requestAnimationFrame(draw)
  }
  if (name !== 'none' || text) raf = requestAnimationFrame(draw)
  const timer = setTimeout(cleanup, ms)
  function cleanup() { if (stopped) return; stopped = true; cancelAnimationFrame(raf); clearTimeout(timer); observer.disconnect(); canvas.remove() }
  return cleanup
}
