import { execute, fail, first, id, now, number, rows, stmt, text, write } from './db.js'
import { passwordHash, userList } from './auth.js'

export async function scope(db, user, company) {
  if (!user.is_superuser && company && id(company) !== user.empresa_id) fail(403, 'No tienes acceso a esa empresa.')
  const companies = user.is_superuser
    ? await rows(db, 'SELECT id,nombre,ruc,direccion,telefono FROM empresas_empresa ORDER BY id')
    : await rows(db, 'SELECT id,nombre,ruc,direccion,telefono FROM empresas_empresa WHERE id=?', user.empresa_id ?? null)
  const active = company ? companies.find(row => row.id === id(company)) : companies[0]
  if (!active && company) fail(404, 'Empresa no encontrada.')
  return { companies, active }
}

const scopedQueries = {
  categories: 'SELECT id,nombre FROM inventario_categoria WHERE empresa_id=? ORDER BY nombre',
  products: `SELECT p.id,p.nombre,p.codigo_barras,p.stock_actual,p.stock_minimo,p.precio_venta,p.costo_promedio,
      p.lead_time_dias,p.empresa_id,p.es_simulado,p.activo,p.categoria_id,c.nombre AS categoria
    FROM inventario_producto p JOIN inventario_categoria c ON c.id=p.categoria_id AND c.empresa_id=p.empresa_id
    WHERE p.empresa_id=? ORDER BY p.nombre`,
  sales: `SELECT id,numero_ticket,fecha,total,metodo_pago,empresa_id,es_simulado
    FROM operaciones_venta WHERE empresa_id=? ORDER BY fecha DESC,id DESC`,
  lines: `SELECT d.id,d.venta_id,d.producto_id,d.cantidad,d.precio_unitario,p.nombre AS producto
    FROM operaciones_detalleventa d JOIN operaciones_venta v ON v.id=d.venta_id
    LEFT JOIN inventario_producto p ON p.id=d.producto_id AND p.empresa_id=v.empresa_id
    WHERE v.empresa_id=? ORDER BY d.id`,
  movements: `SELECT k.id,k.producto_id,k.venta_id,k.fecha,k.tipo_movimiento,k.cantidad,k.costo_unitario,
      k.stock_resultante,k.empresa_id,k.es_simulado,p.nombre AS producto,v.numero_ticket
    FROM operaciones_kardex k LEFT JOIN inventario_producto p ON p.id=k.producto_id AND p.empresa_id=k.empresa_id
    LEFT JOIN operaciones_venta v ON v.id=k.venta_id AND v.empresa_id=k.empresa_id
    WHERE k.empresa_id=? ORDER BY k.fecha DESC,k.id DESC`,
  expenses: `SELECT id,descripcion,categoria,monto,fecha,empresa_id
    FROM finanzas_gastooperativo WHERE empresa_id=? ORDER BY fecha DESC,id DESC`,
}

export async function snapshot(db, user, { companies, active }) {
  const queries = Object.entries(scopedQueries)
  const results = active ? await db.batch(queries.map(([, sql]) => stmt(sql, active.id)), 'read') : []
  const data = Object.fromEntries(queries.map(([key], index) => [key, results[index]?.rows || []]))
  return { ...data, companies, company: active || null, user, users: user.is_superuser ? await userList(db) : [] }
}

async function stockMovement(tx, { type, quantity, cost, stock, product, sale = null, company }) {
  await execute(tx, `INSERT INTO operaciones_kardex
    (tipo_movimiento,cantidad,costo_unitario,stock_resultante,producto_id,venta_id,empresa_id,es_simulado,fecha)
    VALUES (?,?,?,?,?,?,?,0,?)`, type, quantity, cost, stock, product, sale, company, now())
}

export async function sell(db, company, body) {
  const productId = id(body.producto_id)
  const quantity = number(body.cantidad, 'cantidad', { min: 1, max: 10000 })
  const payment = body.metodo_pago || 'EFECTIVO'
  if (!['EFECTIVO', 'DIGITAL', 'TARJETA'].includes(payment)) fail(400, 'Selecciona un método de pago válido.')
  if (typeof body.request_id !== 'string' || !/^[a-f\d-]{36}$/i.test(body.request_id)) fail(400, 'Solicitud de venta inválida.')
  return write(db, async tx => {
    const prior = await first(tx, `SELECT r.venta_id AS id,v.numero_ticket,v.total FROM control_sale_request r
      JOIN operaciones_venta v ON v.id=r.venta_id AND v.empresa_id=r.empresa_id
      WHERE r.empresa_id=? AND r.request_id=?`, company, body.request_id)
    if (prior) return prior
    const product = await first(tx, 'SELECT * FROM inventario_producto WHERE id=? AND empresa_id=? AND activo=1', productId, company)
    if (!product) fail(404, 'Producto activo no encontrado.')
    const stock = product.stock_actual - quantity
    if (stock < 0) fail(409, 'No hay stock suficiente para registrar esta venta.')
    const total = Math.round(Number(product.precio_venta) * 100) * quantity / 100
    if (total > 9_999_999_999.99) fail(400, 'El importe supera el máximo permitido.')
    const sequence = await first(tx, `SELECT MAX(CAST(SUBSTR(numero_ticket,6) AS INTEGER)) AS last
      FROM operaciones_venta WHERE empresa_id=? AND numero_ticket GLOB 'B001-[0-9]*'`, company)
    const ticket = 'B001-' + String((sequence.last || 0) + 1).padStart(8, '0')
    const created = await execute(tx, `INSERT INTO operaciones_venta
      (numero_ticket,total,metodo_pago,empresa_id,es_simulado,fecha) VALUES (?,?,?,?,0,?)`, ticket, total, payment, company, now())
    const sale = Number(created.lastInsertRowid)
    await execute(tx, `INSERT INTO operaciones_detalleventa
      (producto_id,venta_id,cantidad,precio_unitario) VALUES (?,?,?,?)`, productId, sale, quantity, product.precio_venta)
    await execute(tx, 'UPDATE inventario_producto SET stock_actual=? WHERE id=? AND empresa_id=?', stock, productId, company)
    await stockMovement(tx, { type: 'SALIDA_VENTA', quantity, cost: product.costo_promedio, stock, product: productId, sale, company })
    await execute(tx, 'INSERT INTO control_sale_request (empresa_id,request_id,venta_id) VALUES (?,?,?)', company, body.request_id, sale)
    return { id: sale, numero_ticket: ticket, total }
  })
}

export async function saveProduct(db, company, body, productId) {
  const name = text(body.nombre, 'producto', 200)
  const barcode = text(body.codigo_barras, 'código de barras', 64, false) || null
  const cost = number(body.costo_promedio, 'costo promedio', { decimals: true })
  const price = number(body.precio_venta, 'precio', { decimals: true })
  const minimum = number(body.stock_minimo, 'stock mínimo')
  const lead = number(body.lead_time_dias, 'plazo de entrega', { max: 32767 })
  const categoryName = text(body.categoria, 'categoría', 100, !body.categoria_id)
  return write(db, async tx => {
    const current = productId ? await first(tx, 'SELECT * FROM inventario_producto WHERE id=? AND empresa_id=?', productId, company) : null
    if (productId && !current) fail(404, 'Producto no encontrado.')
    if (barcode && await first(tx, 'SELECT id FROM inventario_producto WHERE empresa_id=? AND codigo_barras=? AND id!=?', company, barcode, productId || 0)) {
      fail(409, 'Ya existe un producto con este código de barras.')
    }
    let category = body.categoria_id
      ? await first(tx, 'SELECT id FROM inventario_categoria WHERE empresa_id=? AND id=?', company, id(body.categoria_id))
      : await first(tx, 'SELECT id FROM inventario_categoria WHERE empresa_id=? AND nombre=?', company, categoryName)
    if (body.categoria_id && !category) fail(400, 'Categoría inválida.')
    if (!category) {
      const created = await execute(tx, 'INSERT INTO inventario_categoria (nombre,descripcion,empresa_id,es_simulada) VALUES (?,\'\',?,0)', categoryName, company)
      category = { id: Number(created.lastInsertRowid) }
    }
    const values = [barcode, name, category.id, cost, price, minimum, lead]
    if (current) {
      const active = body.activo === false ? 0 : 1
      await execute(tx, `UPDATE inventario_producto SET codigo_barras=?,nombre=?,categoria_id=?,costo_promedio=?,
        precio_venta=?,stock_minimo=?,lead_time_dias=?,activo=? WHERE id=? AND empresa_id=?`, ...values, active, productId, company)
      return { id: productId }
    }
    const stock = number(body.stock_actual, 'stock inicial')
    const created = await execute(tx, `INSERT INTO inventario_producto
      (codigo_barras,nombre,categoria_id,costo_promedio,precio_venta,stock_minimo,lead_time_dias,
       stock_actual,empresa_id,es_simulado,fecha_registro,activo) VALUES (?,?,?,?,?,?,?,?,?,0,?,1)`, ...values, stock, company, now())
    const product = Number(created.lastInsertRowid)
    if (stock) await stockMovement(tx, { type: 'AJUSTE', quantity: stock, cost, stock, product, company })
    return { id: product }
  })
}

export function adjustStock(db, company, productId, body) {
  const change = number(body.cambio, 'ajuste de unidades', { min: -1_000_000, max: 1_000_000 })
  if (!change) fail(400, 'Ingresa un ajuste distinto de cero.')
  return write(db, async tx => {
    const product = await first(tx, 'SELECT * FROM inventario_producto WHERE id=? AND empresa_id=? AND activo=1', productId, company)
    if (!product) fail(404, 'Producto activo no encontrado.')
    const stock = product.stock_actual + change
    if (stock < 0) fail(409, 'El ajuste dejaría el stock por debajo de cero.')
    await execute(tx, 'UPDATE inventario_producto SET stock_actual=? WHERE id=? AND empresa_id=?', stock, productId, company)
    await stockMovement(tx, { type: 'AJUSTE', quantity: Math.abs(change), cost: product.costo_promedio, stock, product: productId, company })
    return { stock }
  })
}

export function bulkInventory(db, company, body) {
  if (!Array.isArray(body.products) || !body.products.length || body.products.length > 20 ||
      body.products.some(product => !product || typeof product !== 'object' || Array.isArray(product))) {
    fail(400, 'Selecciona entre 1 y 20 productos.')
  }
  const changes = body.products.map(product => ({
    id: id(product.id),
    name: text(product.nombre, 'nombre', 200),
    price: number(product.precio_venta, 'precio de venta', { decimals: true }),
    cost: number(product.costo_promedio, 'costo promedio', { decimals: true }),
    stock: number(product.stock_actual, 'stock'),
    previousStock: number(product.stock_original, 'stock anterior'),
    minimum: number(product.stock_minimo, 'stock mínimo'),
  }))
  if (new Set(changes.map(product => product.id)).size !== changes.length) fail(400, 'Hay productos duplicados.')
  return write(db, async tx => {
    for (const product of changes) {
      const current = await first(tx, 'SELECT stock_actual FROM inventario_producto WHERE empresa_id=? AND id=? AND activo=1', company, product.id)
      if (!current) fail(404, 'Producto activo no encontrado.')
      if (current.stock_actual !== product.previousStock) fail(409, 'El stock cambió. Cierra el formulario, actualiza la página e inténtalo de nuevo.')
      await execute(tx, `UPDATE inventario_producto SET nombre=?,precio_venta=?,costo_promedio=?,stock_minimo=?,stock_actual=?
        WHERE id=? AND empresa_id=?`, product.name, product.price, product.cost, product.minimum, product.stock, product.id, company)
      const delta = product.stock - current.stock_actual
      if (delta) await stockMovement(tx, { type: 'AJUSTE', quantity: Math.abs(delta), cost: product.cost, stock: product.stock, product: product.id, company })
    }
    return { ok: true }
  })
}

export function removeProduct(db, company, product) {
  return write(db, async tx => {
    const current = await first(tx, 'SELECT id FROM inventario_producto WHERE id=? AND empresa_id=?', product, company)
    if (!current) fail(404, 'Producto no encontrado.')
    const history = await first(tx, `SELECT 1 AS found WHERE EXISTS(SELECT 1 FROM operaciones_kardex WHERE producto_id=?)
      OR EXISTS(SELECT 1 FROM operaciones_detalleventa WHERE producto_id=?)
      OR EXISTS(SELECT 1 FROM operaciones_detallecompra WHERE producto_id=?)`, product, product, product)
    if (history) await execute(tx, 'UPDATE inventario_producto SET activo=0 WHERE id=? AND empresa_id=?', product, company)
    else await execute(tx, 'DELETE FROM inventario_producto WHERE id=? AND empresa_id=?', product, company)
    return { archived: Boolean(history) }
  })
}

export async function saveExpense(db, company, body) {
  const description = text(body.descripcion, 'descripción', 255)
  const category = text(body.categoria, 'categoría', 100)
  const amount = number(body.monto, 'importe', { min: 0.01, decimals: true })
  const date = text(body.fecha, 'fecha', 10)
  const parsed = new Date(date + 'T00:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== date) fail(400, 'Selecciona una fecha válida.')
  const result = await execute(db, 'INSERT INTO finanzas_gastooperativo (descripcion,categoria,monto,fecha,empresa_id) VALUES (?,?,?,?,?)', description, category, amount, date, company)
  return { id: Number(result.lastInsertRowid) }
}

export async function saveCompany(db, company, body) {
  const name = text(body.nombre, 'empresa', 150)
  const ruc = text(body.ruc, 'RUC', 20, false)
  const address = text(body.direccion, 'dirección', 500, false)
  const phone = text(body.telefono, 'teléfono', 30, false)
  if (await first(db, 'SELECT id FROM empresas_empresa WHERE nombre=? AND id!=?', name, company)) fail(409, 'Ya existe una empresa con ese nombre.')
  await execute(db, 'UPDATE empresas_empresa SET nombre=?,ruc=?,direccion=?,telefono=? WHERE id=?', name, ruc, address, phone, company)
  return { ok: true }
}

export async function saveUser(db, actor, body, userId) {
  const username = text(body.username, 'usuario', 150)
  const firstName = text(body.first_name, 'nombre', 150, false)
  const lastName = text(body.last_name, 'apellido', 150, false)
  const email = text(body.email, 'correo', 254, false)
  const company = id(body.empresa_id)
  const superuser = body.is_superuser === true ? 1 : 0
  const staff = body.is_staff === true || superuser ? 1 : 0
  const active = body.is_active === false ? 0 : 1
  if (userId === actor.id && (!superuser || !active)) fail(400, 'Conserva el acceso de tu propia cuenta.')
  const hash = !userId || body.password ? await passwordHash(body.password) : null
  return write(db, async tx => {
    if (!await first(tx, 'SELECT id FROM empresas_empresa WHERE id=?', company)) fail(400, 'Empresa inválida.')
    if (await first(tx, 'SELECT id FROM auth_user WHERE username=? AND id!=?', username, userId || 0)) fail(409, 'Este usuario ya existe.')
    if (email && await first(tx, 'SELECT id FROM auth_user WHERE email=? AND id!=?', email, userId || 0)) fail(409, 'El correo ya está en uso.')
    let target = userId
    const values = [username, firstName, lastName, email, staff, superuser, active]
    if (target) {
      const updated = await execute(tx, `UPDATE auth_user SET username=?,first_name=?,last_name=?,email=?,
        is_staff=?,is_superuser=?,is_active=?,password=COALESCE(?,password) WHERE id=?`, ...values, hash, target)
      if (!updated.rowsAffected) fail(404, 'Usuario no encontrado.')
      if (hash || !active) await execute(tx, 'DELETE FROM control_session WHERE user_id=?', target)
    } else {
      const created = await execute(tx, `INSERT INTO auth_user (username,first_name,last_name,email,
        is_staff,is_superuser,is_active,password,date_joined) VALUES (?,?,?,?,?,?,?,?,?)`, ...values, hash, now())
      target = Number(created.lastInsertRowid)
    }
    await execute(tx, `INSERT INTO empresas_perfilusuario (user_id,empresa_id) VALUES (?,?)
      ON CONFLICT(user_id) DO UPDATE SET empresa_id=excluded.empresa_id`, target, company)
    return { id: target }
  })
}

export function removeUser(db, actor, userId) {
  if (userId === actor.id) fail(400, 'No puedes eliminar tu propia cuenta.')
  return write(db, async tx => {
    await execute(tx, 'DELETE FROM control_session WHERE user_id=?', userId)
    for (const table of ['auth_user_groups', 'auth_user_user_permissions', 'empresas_perfilusuario', 'django_admin_log']) {
      await execute(tx, `DELETE FROM ${table} WHERE user_id=?`, userId)
    }
    if (!(await execute(tx, 'DELETE FROM auth_user WHERE id=?', userId)).rowsAffected) fail(404, 'Usuario no encontrado.')
    return { ok: true }
  })
}

export function resetCompany(db, company, actor, currentHash, confirmation) {
  if (confirmation !== company.nombre) fail(400, 'Escribe el nombre exacto de la empresa.')
  return write(db, async tx => {
    if (!await first(tx, 'SELECT 1 FROM auth_user WHERE id=? AND password=? AND is_active=1', actor.id, currentHash)) {
      fail(409, 'La cuenta cambió. Vuelve a confirmar la operación.')
    }
    await execute(tx, 'DELETE FROM operaciones_detalleventa WHERE venta_id IN (SELECT id FROM operaciones_venta WHERE empresa_id=?)', company.id)
    await execute(tx, 'DELETE FROM operaciones_detallecompra WHERE compra_id IN (SELECT id FROM operaciones_compra WHERE empresa_id=?)', company.id)
    for (const table of ['control_sale_request', 'operaciones_kardex', 'operaciones_venta', 'operaciones_compra', 'inventario_producto', 'inventario_categoria', 'operaciones_proveedor']) {
      await execute(tx, `DELETE FROM ${table} WHERE empresa_id=?`, company.id)
    }
    return { ok: true }
  })
}
