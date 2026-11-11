import * as THREE from 'three'

export function createSaveAnimation(canvas) {
  let renderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
  } catch {
    canvas.dataset.fallback = 'true'
    canvas.style.backgroundImage = `url(${chrome.runtime.getURL('icons/favicon-32.png')})`
    canvas.style.backgroundPosition = 'center'
    canvas.style.backgroundRepeat = 'no-repeat'
    canvas.style.backgroundSize = '40px 40px'
    return { setState: (state) => { canvas.dataset.state = state }, dispose() {} }
  }

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 20)
  camera.position.set(0, 0.05, 3.3)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.setSize(72, 72, false)
  renderer.setClearColor(0x000000, 0)
  scene.add(new THREE.HemisphereLight(0xd8eaff, 0x182332, 2.2))
  const keyLight = new THREE.DirectionalLight(0x8fc4ff, 3)
  keyLight.position.set(-2, 3, 4)
  scene.add(keyLight)

  const vault = new THREE.Group()
  scene.add(vault)
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x4d8ee8, metalness: 0.48, roughness: 0.28 })
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.95, 0.45), bodyMaterial)
  vault.add(body)
  const border = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({ color: 0xb8d9ff }))
  border.position.copy(body.position)
  vault.add(border)
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.22, 0.065, 10, 28),
    new THREE.MeshStandardMaterial({ color: 0xdceaff, metalness: 0.68, roughness: 0.25 }),
  )
  ring.position.z = 0.27
  vault.add(ring)
  const keyhole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 12), new THREE.MeshBasicMaterial({ color: 0x17263b }))
  keyhole.rotation.z = Math.PI / 2
  keyhole.position.set(0, -0.11, 0.29)
  vault.add(keyhole)

  const check = new THREE.Group()
  const checkMaterial = new THREE.MeshBasicMaterial({ color: 0x8df0b2 })
  const checkShort = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.1), checkMaterial)
  checkShort.position.set(-0.11, -0.01, 0.42)
  checkShort.rotation.z = -0.72
  const checkLong = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.52, 0.1), checkMaterial)
  checkLong.position.set(0.13, 0.07, 0.43)
  checkLong.rotation.z = 0.72
  check.add(checkShort, checkLong)
  check.visible = false
  vault.add(check)

  let state = 'saving'
  let frame = 0
  let started = performance.now()
  let successAt = 0
  let disposed = false
  const animate = (now) => {
    if (disposed) return
    const elapsed = now - started
    if (state === 'saving') {
      vault.rotation.y = Math.sin(elapsed * 0.0017) * 0.38
      vault.rotation.x = Math.sin(elapsed * 0.0011) * 0.1
      const pulse = 1 + Math.sin(elapsed * 0.006) * 0.035
      vault.scale.setScalar(pulse)
    } else if (state === 'success') {
      const bounce = Math.max(0, 1 - (now - successAt) / 420)
      vault.rotation.set(0, 0, 0)
      vault.scale.setScalar(1 + Math.sin((1 - bounce) * Math.PI) * 0.16 * bounce)
    } else if (state === 'error') {
      vault.rotation.set(0, 0, 0)
      vault.scale.setScalar(1)
    }
    renderer.render(scene, camera)
    if (state === 'success' && now - successAt > 1200) {
      frame = 0
      return
    }
    if (state === 'error') {
      frame = 0
      return
    }
    frame = requestAnimationFrame(animate)
  }
  frame = requestAnimationFrame(animate)

  return {
    setState(next) {
      state = next
      started = performance.now()
      if (next === 'success') {
        successAt = started
        check.visible = true
        bodyMaterial.color.set(0x287c58)
        ring.material.color.set(0xbaf7d1)
      } else if (next === 'error') {
        check.visible = false
        bodyMaterial.color.set(0xb84f58)
      if (!frame) frame = requestAnimationFrame(animate)
      } else {
        check.visible = false
        bodyMaterial.color.set(0x4d8ee8)
        ring.material.color.set(0xdceaff)
        if (!frame) frame = requestAnimationFrame(animate)
      }
    },
    dispose() {
      disposed = true
      if (frame) cancelAnimationFrame(frame)
      body.geometry.dispose()
      border.geometry.dispose()
      ring.geometry.dispose()
      keyhole.geometry.dispose()
      checkShort.geometry.dispose()
      checkLong.geometry.dispose()
      bodyMaterial.dispose()
      border.material.dispose()
      ring.material.dispose()
      keyhole.material.dispose()
      checkMaterial.dispose()
      renderer.dispose()
    },
  }
}
