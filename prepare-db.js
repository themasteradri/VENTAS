import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'

const source = resolve(process.argv[2] || '../sistema-ventas/db.sqlite3')
const destination = resolve(process.argv[3] || 'control.local.sqlite3')
if (!existsSync(source)) throw new Error('Indica la ruta del SQLite de Django.')
if (existsSync(destination)) throw new Error('El destino ya existe. Usa otro nombre para conservar tus cambios.')

const original = new DatabaseSync(source, { readOnly: true })
try {
  original.prepare('SELECT id FROM auth_user LIMIT 1').get()
  await backup(original, destination)
} finally {
  original.close()
}
const copy = new DatabaseSync(destination)
try {
  copy.exec('DELETE FROM django_session; VACUUM')
} finally {
  copy.close()
}
console.log(`Copia preparada en ${destination}`)
