import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Same "@/" alias as tsconfig.json paths.
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
