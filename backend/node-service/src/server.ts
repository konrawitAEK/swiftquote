// Entry point. Reads the same env vars as the Go service (see docker-compose.yml).
import pg from 'pg'
import { buildApp } from './app.js'
import { Repository } from './repository.js'
import { AuthService, QuoteService } from './services.js'

const env = (key: string, fallback: string) => process.env[key] || fallback

const jwtSecret = process.env.JWT_SECRET ?? ''
// HS256 needs a key at least as long as the hash (32 bytes); the Go and Spring services enforce this too.
if (Buffer.byteLength(jwtSecret) < 32) {
  console.error('config: JWT_SECRET is required and must be at least 32 bytes')
  process.exit(1)
}

const pool = new pg.Pool({
  host: env('DB_HOST', 'localhost'),
  port: Number(env('DB_PORT', '5432')),
  user: env('DB_USER', 'postgres'),
  password: env('DB_PASSWORD', 'password'),
  database: env('DB_NAME', 'swiftquote'),
})

const repo = new Repository(pool)
const app = await buildApp({
  repo,
  auth: new AuthService(repo, jwtSecret),
  quotes: new QuoteService(repo),
  corsOrigins: env('CORS_ORIGINS', 'http://localhost:3000,http://localhost:3001,http://localhost:3002')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  logger: true,
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close()
    await pool.end()
    process.exit(0)
  })
}

await app.listen({ host: '0.0.0.0', port: Number(env('PORT', '8080')) })
