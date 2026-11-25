import { createHash, pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { execute, fail, first, now, rows, text, write } from './db.js'

const derive = promisify(pbkdf2)
const iterations = 1_000_000
const dummy = `pbkdf2_sha256$${iterations}$control-login-salt$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`
const duration = 8 * 60 * 60
const cookieName = 'control_session'
const digest = value => createHash('sha256').update(value).digest('hex')
const epoch = () => Math.floor(Date.now() / 1000)
const privateFields = 'u.id, u.username, u.first_name, u.last_name, u.email, u.is_staff, u.is_superuser, u.is_active, p.empresa_id'

function readToken(request) {
  const entry = (request.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='))
  const token = entry?.slice(cookieName.length + 1)
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? digest(token) : null
}

function cookie(token, seconds) {
  return `${cookieName}=${token}; Path=/; Max-Age=${seconds}; HttpOnly; SameSite=Lax${process.env.VERCEL ? '; Secure' : ''}`
}

function passwordInput(password, creating) {
  if (typeof password !== 'string' || password.length > 256 || (creating && password.length < 10)) {
    fail(400, creating ? 'La contraseña debe tener entre 10 y 256 caracteres.' : 'Credenciales inválidas.')
  }
  return password
}

async function matches(password, encoded) {
  const [algorithm, count, salt, hash] = String(encoded ?? '').split('$')
  const rounds = Number(count)
  const valid = algorithm === 'pbkdf2_sha256' && Number.isInteger(rounds) && rounds > 0 && rounds <= 3_000_000 && /^[A-Za-z0-9]+$/.test(salt || '') && /^[A-Za-z0-9+/]{43}=$/.test(hash || '')
  const result = await derive(password, valid ? salt : 'control-login-salt', valid ? rounds : iterations, 32, 'sha256')
  const expected = Buffer.from(valid ? hash : dummy.split('$')[3], 'base64')
  return timingSafeEqual(result, expected) && valid
}

export async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = await derive(passwordInput(password, true), salt, iterations, 32, 'sha256')
  return `pbkdf2_sha256$${iterations}$${salt}$${hash.toString('base64')}`
}

export async function login(db, request, response, body) {
  const username = text(body.username, 'usuario', 150)
  const password = passwordInput(body.password, false)
  const timestamp = epoch()
  const ip = process.env.VERCEL ? request.headers['x-vercel-forwarded-for'] : request.socket?.remoteAddress
  const key = digest(String(ip || 'unknown').split(',')[0])
  const limit = await first(db, `INSERT INTO control_login_rate (ip, window_start, attempts) VALUES (?, ?, 1)
    ON CONFLICT(ip) DO UPDATE SET
      attempts=CASE WHEN window_start <= ? THEN 1 ELSE attempts+1 END,
      window_start=CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END
    RETURNING attempts`, key, timestamp, timestamp - 900, timestamp - 900)
  if (limit.attempts > 30) fail(429, 'Demasiados intentos. Intenta nuevamente en unos minutos.')
  const user = await first(db, 'SELECT id,password,is_active FROM auth_user WHERE username=?', username)
  const verified = await matches(password, user?.password)
  if (!verified || !user?.is_active) fail(401, 'Usuario o contraseña incorrectos.')
  const token = randomBytes(32).toString('base64url')
  await write(db, async tx => {
    const previous = readToken(request)
    if (previous) await execute(tx, 'DELETE FROM control_session WHERE token_hash=?', previous)
    await execute(tx, 'DELETE FROM control_session WHERE expires_at <= ?', timestamp)
    await execute(tx, 'DELETE FROM control_login_rate WHERE window_start <= ?', timestamp - 900)
    await execute(tx, 'INSERT INTO control_session VALUES (?,?,?)', digest(token), user.id, timestamp + duration)
    await execute(tx, 'UPDATE auth_user SET last_login=? WHERE id=?', now(), user.id)
  })
  response.setHeader('Set-Cookie', cookie(token, duration))
  return { ok: true }
}

export async function logout(db, request, response) {
  const token = readToken(request)
  if (token) await execute(db, 'DELETE FROM control_session WHERE token_hash=?', token)
  response.setHeader('Set-Cookie', cookie('', 0))
  return { ok: true }
}

export async function userFor(db, request) {
  const token = readToken(request)
  if (!token) fail(401, 'Inicia sesión para continuar.')
  const user = await first(db, `SELECT ${privateFields} FROM control_session s
    JOIN auth_user u ON u.id=s.user_id AND u.is_active=1
    LEFT JOIN empresas_perfilusuario p ON p.user_id=u.id
    WHERE s.token_hash=? AND s.expires_at>?`, token, epoch())
  if (!user) fail(401, 'Tu sesión expiró. Vuelve a iniciar sesión.')
  return { ...user, is_superuser: Boolean(user.is_superuser), is_staff: Boolean(user.is_staff) }
}

export async function changePassword(db, user, body) {
  const currentHash = await verifyCurrent(db, user, body.current)
  const hash = await passwordHash(body.password)
  await write(db, async tx => {
    const result = await execute(tx, 'UPDATE auth_user SET password=? WHERE id=? AND password=?', hash, user.id, currentHash)
    if (!result.rowsAffected) fail(409, 'La contraseña cambió durante la operación.')
    await execute(tx, 'DELETE FROM control_session WHERE user_id=?', user.id)
  })
  return { ok: true }
}

export async function verifyCurrent(db, user, password) {
  const current = passwordInput(password, false)
  const stored = await first(db, 'SELECT password FROM auth_user WHERE id=? AND is_active=1', user.id)
  if (!await matches(current, stored?.password)) fail(400, 'La contraseña actual es incorrecta.')
  return stored.password
}

export async function userList(db) {
  return rows(db, `SELECT ${privateFields}, e.nombre AS empresa FROM auth_user u
    LEFT JOIN empresas_perfilusuario p ON p.user_id=u.id
    LEFT JOIN empresas_empresa e ON e.id=p.empresa_id ORDER BY u.username`)
}
