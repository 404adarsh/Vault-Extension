import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  configFile: false,
  build: {
    lib: {
      entry: resolve(root, 'three-animation-entry.js'),
      formats: ['es'],
      fileName: () => 'three-animation.js',
    },
    outDir: resolve(root, 'vendor'),
    emptyOutDir: false,
    sourcemap: false,
  },
})
