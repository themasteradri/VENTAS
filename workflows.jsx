import React, { useEffect, useRef, useState } from 'react'
import { ClipboardList, Download, X } from 'lucide-react'
import { dateLabel, money, salesCsv, salesReport } from './data'

export async function api(path, { method = 'GET', body = {}, company, signal } = {}) {
  const query = company ? '?empresa=' + encodeURIComponent(company) : ''
  const response = await fetch(`/api/${path}${query}`, {
    method, signal,
    ...(method !== 'GET' && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const result = await response.json()
  if (!response.ok) throw Object.assign(new Error(result.error || 'No se pudo completar la operación.'), { status: response.status })
  return result
}

export function Login({ onLogin }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function enter(event) {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))
    setBusy(true)
    setError('')
    try {
      await api('login', { method: 'POST', body: values })
      onLogin()
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }
  return <main className="login-page"><form className="panel login-panel" onSubmit={enter}>
    <span className="brand-mark"><ClipboardList size={23} /></span>
    <h1>Iniciar sesión</h1>
    <p>Control · Sistema de ventas</p>
    <label>Usuario<input name="username" autoComplete="username" required autoFocus /></label>
    <label>Contraseña<input name="password" type="password" autoComplete="current-password" required /></label>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="primary" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
  </form></main>
}

const field = (name, label, type = 'text', options = {}) => ({ name, label, type, ...options })
const quantity = (name, label, options = {}) => field(name, label, 'number', { min: 0, step: 1, ...options })
const amount = (name, label, options = {}) => quantity(name, label, { step: 0.01, ...options })
const options = items => items.map(item => [item.id, item.nombre])

function formFor(mode, row, data) {
  switch (mode) {
    case 'sale':
      return {
        title: 'Registrar venta', endpoint: 'ventas', fields: [
          field('producto_id', 'Producto', 'select', { choices: [['', 'Selecciona un producto'], ...data.products.filter(product => product.activo && product.stock_actual > 0).map(product => [product.id, `${product.nombre} · ${product.stock_actual} en stock`])] }),
          quantity('cantidad', 'Cantidad', { min: 1, value: 1 }),
          field('metodo_pago', 'Método de pago', 'select', { choices: [['EFECTIVO', 'Efectivo'], ['DIGITAL', 'Digital'], ['TARJETA', 'Tarjeta']] }),
        ],
      }
    case 'product':
      return {
        title: row ? 'Editar producto' : 'Nuevo producto', endpoint: 'inventario', method: row ? 'PATCH' : 'POST',
        fields: [
          field('nombre', 'Nombre'), field('codigo_barras', 'Código de barras', 'text', { optional: true }),
          field('categoria_id', 'Categoría existente', 'select', { optional: true, choices: [['', 'Crear o escribir categoría'], ...options(data.categories)] }),
          field('categoria', 'Nombre de la categoría nueva', 'text', { optional: true, value: '' }),
          amount('costo_promedio', 'Costo promedio', { value: 0 }), amount('precio_venta', 'Precio de venta', { value: 0 }),
          quantity('stock_minimo', 'Stock mínimo', { value: 0 }), quantity('lead_time_dias', 'Plazo de entrega en días', { value: 0 }),
          ...(row ? [field('activo', 'Producto activo', 'checkbox')] : [quantity('stock_actual', 'Stock inicial', { value: 0 })]),
        ],
      }
    case 'stock':
      return { title: 'Ajustar stock', endpoint: 'ajuste', fields: [quantity('cambio', 'Unidades a sumar o restar', { min: -1000000 })], description: row.nombre }
    case 'remove':
      return { title: 'Retirar producto', endpoint: 'inventario', method: 'DELETE', fields: [], description: `${row.nombre}. Si tiene historial, se archivará para conservar sus operaciones.` }
    case 'expense':
      return { title: 'Registrar gasto', endpoint: 'gastos', fields: [field('descripcion', 'Descripción'), field('categoria', 'Categoría'), amount('monto', 'Importe', { min: 0.01 }), field('fecha', 'Fecha', 'date', { value: new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Lima' }).format() })] }
    case 'company':
      return { title: 'Editar empresa', endpoint: 'empresa', method: 'PATCH', fields: [field('nombre', 'Nombre'), field('ruc', 'RUC', 'text', { optional: true }), field('direccion', 'Dirección', 'text', { optional: true }), field('telefono', 'Teléfono', 'tel', { optional: true })] }
    case 'user':
      return {
        title: row ? 'Editar usuario' : 'Nuevo usuario', endpoint: 'usuarios', method: row ? 'PATCH' : 'POST',
        fields: [
          field('username', 'Usuario'), field('first_name', 'Nombre', 'text', { optional: true }),
          field('last_name', 'Apellido', 'text', { optional: true }), field('email', 'Correo', 'email', { optional: true }),
          field('empresa_id', 'Empresa', 'select', { choices: options(data.companies) }),
          field('password', row ? 'Nueva contraseña (opcional)' : 'Contraseña', 'password', { optional: Boolean(row), minLength: 10 }),
          field('is_active', 'Usuario activo', 'checkbox', { value: true }), field('is_staff', 'Administrador', 'checkbox'), field('is_superuser', 'Superusuario', 'checkbox'),
        ],
      }
    case 'password':
      return { title: 'Cambiar contraseña', endpoint: 'password', fields: [field('current', 'Contraseña actual', 'password'), field('password', 'Nueva contraseña', 'password', { minLength: 10 }), field('confirmation', 'Confirmar contraseña', 'password', { minLength: 10 })] }
    case 'remove-user':
      return { title: 'Dar de baja usuario', endpoint: 'usuarios', method: 'DELETE', fields: [], description: `La cuenta ${row.username} se eliminará. Los datos de su empresa se conservarán.`, submit: 'Dar de baja' }
    case 'reset':
      return { title: 'Reiniciar datos de empresa', endpoint: 'reiniciar',
        description: `Se borrarán las ventas, compras, productos, categorías, proveedores y movimientos de ${row.nombre}.`,
        fields: [field('confirmation', 'Nombre exacto de la empresa'), field('current', 'Tu contraseña', 'password')], submit: 'Reiniciar datos' }
    default:
      throw new Error('Formulario desconocido.')
  }
}

export function ActionForm({ action, data, onClose, onSave, onAction }) {
  const dialog = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [requestId] = useState(() => action.mode === 'sale' ? crypto.randomUUID() : '')
  const { row, mode } = action
  const { title, endpoint, method = 'POST', fields, description, submit: submitLabel } = formFor(mode, row, data)
  useEffect(() => { dialog.current.showModal() }, [])
  async function submit(event) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const body = Object.fromEntries(fields.map(item => [item.name, item.type === 'checkbox' ? values.has(item.name) : values.get(item.name)]))
    if (row?.id) body.id = row.id
    if (mode === 'sale') body.request_id = requestId
    if (mode === 'password' && body.password !== body.confirmation) { setError('Las contraseñas no coinciden.'); return }
    setBusy(true)
    setError('')
    try {
      const result = await api(endpoint, { method, body, company: data.company?.id })
      onSave(result, mode)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }
  return <dialog className="dialog" ref={dialog} aria-labelledby="action-title" onClose={onClose} onCancel={event => { if (busy) event.preventDefault() }}>
    <form className="dialog-body" onSubmit={submit}>
      <div className="dialog-header"><div><h2 id="action-title">{title}</h2>{description && <p>{description}</p>}</div>
        <button type="button" className="icon-button" aria-label="Cerrar formulario" disabled={busy} onClick={() => dialog.current.close()}><X size={22} /></button>
      </div>
      <div className="field-grid">{fields.map(item => {
        const { name, label, type, choices, optional, value, ...attrs } = item
        const initial = type === 'password' ? '' : row?.[name] ?? value ?? ''
        const required = !optional
        return <label key={name} className={type === 'checkbox' ? 'checkbox' : undefined}>
          {type === 'checkbox' ? <><input type="checkbox" name={name} defaultChecked={Boolean(initial)} />{label}</> : <>
            {label}
            {type === 'select' ? <select name={name} aria-label={label} defaultValue={initial} required={required}>{choices.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select> :
              <input name={name} type={type} defaultValue={initial} required={required} {...attrs} />}
          </>}
        </label>
      })}</div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions">
        {mode === 'user' && row && row.id !== data.user.id && <button type="button" className="secondary" disabled={busy} onClick={() => onAction('remove-user', row)}>Dar de baja</button>}
        <button className={submitLabel || mode === 'remove' ? 'primary danger' : 'primary'} disabled={busy}>{busy ? 'Guardando…' : submitLabel || (mode === 'remove' ? 'Retirar producto' : 'Guardar')}</button>
      </div>
    </form>
  </dialog>
}

const bulkFields = [
  ['nombre', 'Nombre', 'text'],
  ['costo_promedio', 'Costo', 'number', '0.01'],
  ['precio_venta', 'Precio', 'number', '0.01'],
  ['stock_actual', 'Stock', 'number', '1'],
  ['stock_minimo', 'Stock mínimo', 'number', '1'],
]

export function BulkInventory({ products, company, onClose, onSave }) {
  const dialog = useRef(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { dialog.current.showModal() }, [])
  async function submit(event) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const changed = products.flatMap(product => {
      const fields = Object.fromEntries(bulkFields.map(([key]) => [key, values.get(`${product.id}-${key}`)]))
      return bulkFields.some(([key]) => String(product[key]) !== fields[key])
        ? [{ ...fields, id: product.id, stock_original: product.stock_actual }]
        : []
    })
    if (!changed.length) { onClose(); return }
    setBusy(true)
    setError('')
    try {
      onSave(await api('inventario-lote', { method: 'PATCH', company, body: { products: changed } }), 'bulk')
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }
  return <dialog className="dialog bulk-dialog" aria-labelledby="bulk-title" ref={dialog} onClose={onClose} onCancel={event => { if (busy) event.preventDefault() }}>
    <form className="dialog-body" onSubmit={submit}>
      <div className="dialog-header"><div><h2 id="bulk-title">Editar inventario por lote</h2><p>{products.length} productos activos de esta página</p></div>
        <button type="button" className="icon-button" aria-label="Cerrar edición" onClick={() => dialog.current.close()} disabled={busy}><X size={22} /></button>
      </div>
      <div className="table-scroll"><table><thead><tr>{bulkFields.map(([key, label]) => <th key={key} scope="col">{label}</th>)}</tr></thead>
        <tbody>{products.map(product => <tr key={product.id}>{bulkFields.map(([key, label, type, step]) => <td key={key}>
          <input aria-label={`${label} de ${product.nombre}`} name={`${product.id}-${key}`} defaultValue={product[key]} type={type} step={step} min={type === 'number' ? 0 : undefined} required />
        </td>)}</tr>)}</tbody>
      </table></div>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="dialog-actions"><button className="primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button></div>
    </form>
  </dialog>
}

function download(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function SalesExport({ sales, month, onClose }) {
  const dialog = useRef(null)
  const [range, setRange] = useState(month ? 'periodo' : 'hoy')
  const [error, setError] = useState('')
  useEffect(() => { dialog.current.showModal() }, [])

  function exportReport(event) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    try {
      const selected = salesReport(sales, { range, month, start: values.get('start'), end: values.get('end') })
      if (!selected.length) {
        setError('No hay ventas en el rango seleccionado.')
        return
      }
      download(new Blob([salesCsv(selected)], { type: 'text/csv;charset=utf-8' }), `reporte_ventas_${range}.csv`)
      dialog.current.close()
    } catch (failure) {
      setError(failure.message)
    }
  }

  return <dialog className="dialog" ref={dialog} aria-labelledby="export-title" onClose={onClose}>
    <form className="dialog-body" onSubmit={exportReport} onChange={() => setError('')}>
      <div className="dialog-header"><h2 id="export-title">Exportar ventas</h2>
        <button type="button" className="icon-button" aria-label="Cerrar exportación" onClick={() => dialog.current.close()}><X size={22} /></button>
      </div>
      <div className="field-grid">
        <label>Período
          <select aria-label="Período de exportación" value={range} onChange={event => setRange(event.target.value)}>
            <option value="hoy">Hoy</option>
            <option value="semana">Esta semana (últimos 7 días)</option>
            <option value="mes">Este mes</option>
            <option value="personalizado">Rango personalizado</option>
            {month && <option value="periodo">Mes seleccionado ({month})</option>}
            <option value="historial">Todo el historial</option>
          </select>
        </label>
        {range === 'personalizado' && <div className="export-dates">
          <label>Desde<input name="start" type="date" required /></label>
          <label>Hasta<input name="end" type="date" required /></label>
        </div>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions"><button className="primary"><Download size={16} /> Descargar CSV</button></div>
    </form>
  </dialog>
}

export async function downloadReceipt(sale, lines, company) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  const clean = value => String(value ?? '').replace(/[^\u0020-\u007e\u00a0-\u00ff]/g, ' ').slice(0, 105)
  let page
  let y
  function addPage() {
    page = document.addPage([460, 580])
    y = 532
  }
  function line(value, size = 11, face = font) {
    if (y < 55) addPage()
    page.drawText(clean(value), { x: 42, y, size, font: face, color: rgb(.08, .17, .30), maxWidth: 376 })
    y -= size + 11
  }
  addPage()
  line('Boleta de venta', 22, bold)
  line(company.nombre, 14, bold)
  if (company.ruc) line('RUC: ' + company.ruc)
  if (company.direccion) line(company.direccion)
  line(`Ticket ${sale.numero_ticket} · ${dateLabel(sale.fecha)}`)
  line(`Pago: ${sale.metodo_pago}`)
  y -= 10
  for (const item of lines) line(`${item.cantidad} × ${item.producto || 'Producto'} · ${money(item.precio_unitario * item.cantidad)}`)
  y -= 10
  line(`Total: ${money(sale.total)}`, 15, bold)
  download(new Blob([await document.save()], { type: 'application/pdf' }), `${sale.numero_ticket}.pdf`)
}
