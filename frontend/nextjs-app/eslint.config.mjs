import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Generated from contracts/openapi.yaml by `make gen-types`; never hand-edited.
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'src/api/schema.d.ts']),
])
