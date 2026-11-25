import { resolve } from 'node:path'
import { createClient } from '@libsql/client'

let database
export async function getDatabase() {
  database ??= connect().catch(error => {
    database = undefined
    throw error
  })
  return database
}

async function connect() {
  const remoteUrl = process.env.TURSO_DATABASE_URL
  const token = process.env.TURSO_AUTH_TOKEN
  if (remoteUrl && (!/^(libsql|https):\/\//.test(remoteUrl) || !token)) {
    throw new Error('Configura una URL remota de Turso y su token.')
  }
  if (process.env.VERCEL && !remoteUrl) throw new Error('Falta configurar Turso.')
  const path = resolve(process.env.LOCAL_DB_PATH || 'control.local.sqlite3').replaceAll('\\', '/')
  const client = createClient(remoteUrl ? { url: remoteUrl, authToken: token } : { url: `file:${path}` })
  try {
    await client.execute('SELECT id FROM auth_user LIMIT 1')
    await client.batch([
      `CREATE TABLE IF NOT EXISTS control_session (
        token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS control_session_user ON control_session(user_id)',
      `CREATE TABLE IF NOT EXISTS control_login_rate (
        ip TEXT PRIMARY KEY, window_start INTEGER NOT NULL, attempts INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS control_sale_request (
        empresa_id INTEGER NOT NULL, request_id TEXT NOT NULL, venta_id INTEGER NOT NULL,
        PRIMARY KEY (empresa_id, request_id)
      )`,
    ], 'write')
    return client
  } catch (error) {
    client.close()
    throw error
  }
}

export const stmt = (sql, ...args) => ({ sql, args })
export const execute = (db, sql, ...args) => db.execute(stmt(sql, ...args))
export const rows = async (db, sql, ...args) => (await execute(db, sql, ...args)).rows
export const first = async (db, sql, ...args) => (await rows(db, sql, ...args))[0]

// SQLite allows one writer at a time. libSQL also takes a write lock on Turso.
let writer = Promise.resolve()
export function write(db, operation) {
  const job = writer.then(async () => {
    const tx = await db.transaction('write')
    try {
      const result = await operation(tx)
      await tx.commit()
      return result
    } finally {
      tx.close()
    }
  })
  writer = job.catch(() => {})
  return job
}

export function fail(status, message) {
  throw Object.assign(new Error(message), { status })
}

export function text(value, label, max, required = true) {
  const result = typeof value === 'string' ? value.trim() : ''
  if ((required && !result) || result.length > max) fail(400, `Revisa el campo ${label}.`)
  return result
}

export function number(value, label, { min = 0, max = 1_000_000_000, decimals = false } = {}) {
  const result = Number(value)
  if ((typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) || !Number.isFinite(result) ||
      result < min || result > max || (!decimals && !Number.isInteger(result))) {
    fail(400, `Revisa el campo ${label}.`)
  }
  return decimals ? Math.round(result * 100) / 100 : result
}

export const id = value => number(value, 'identificador', { min: 1, max: Number.MAX_SAFE_INTEGER })
export const now = () => new Date().toISOString().replace('T', ' ').slice(0, -1)
