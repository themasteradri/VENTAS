const currency = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' })
const reportingDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Lima' })
const reportingTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit' })
const displayDate = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeZone: 'America/Lima' })
const chartDate = new Intl.DateTimeFormat('es-PE', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
const dayMs = 86_400_000

function fromSQLite(value) {
  if (value.length === 10) return new Date(value + 'T12:00:00Z')
  const timestamp = value.replace(' ', 'T')
  return new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp) ? timestamp : timestamp + 'Z')
}

export const money = value => currency.format(Number(value || 0))
export const dayKey = value => value ? reportingDate.format(fromSQLite(value)) : ''
export const limaToday = () => reportingDate.format()
export const dateLabel = value => value ? displayDate.format(fromSQLite(value)) : '—'
export const sum = (rows, field) => rows.reduce((total, row) => total + Number(row[field] || 0), 0)

export function shiftDay(day, offset) {
  return new Date(Date.parse(day) + offset * dayMs).toISOString().slice(0, 10)
}

export function recordsInRange(records, start, end) {
  if (!start && !end) return records
  return records.filter(record => {
    const day = dayKey(record.fecha)
    return day && (!start || day >= start) && (!end || day <= end)
  })
}

function validDay(day) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && shiftDay(day, 0) === day
}

export function salesReport(sales, { range, start, end, month, today = limaToday() }) {
  let firstDay = today
  let lastDay = today
  if (range === 'semana') firstDay = shiftDay(today, -6)
  if (range === 'mes') firstDay = today.slice(0, 7) + '-01'
  if (range === 'personalizado') {
    if (!validDay(start) || !validDay(end)) throw new Error('Ingresa dos fechas válidas para el rango personalizado.')
    firstDay = start <= end ? start : end
    lastDay = start <= end ? end : start
  }
  if (range === 'periodo' && month) {
    firstDay = month + '-01'
    const [year, monthNumber] = month.split('-').map(Number)
    lastDay = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10)
  }
  const inRange = range === 'historial' ? sales : recordsInRange(sales, firstDay, lastDay)
  return [...inRange].sort((first, second) => fromSQLite(first.fecha) - fromSQLite(second.fecha))
}

export function salesCsv(sales) {
  const escape = value => {
    const text = String(value ?? '')
    return '"' + (/^\s*[=+@-]|^[\t\r\n]/.test(text) ? "'" : '') + text.replaceAll('"', '""') + '"'
  }
  const payment = { EFECTIVO: 'Efectivo', DIGITAL: 'Digital', TARJETA: 'Tarjeta' }
  const rows = sales.map(sale => {
    const date = fromSQLite(sale.fecha)
    return [sale.numero_ticket, `${reportingDate.format(date)} ${reportingTime.format(date)}`, payment[sale.metodo_pago] || sale.metodo_pago, Number(sale.total).toFixed(2)]
  })
  return '\ufeffsep=;\r\n' + [['Numero Ticket', 'Fecha', 'Metodo Pago', 'Total (S/.)'], ...rows]
    .map(row => row.map(escape).join(';')).join('\r\n') + '\r\n'
}

export function dailyIncome(sales, start, days) {
  const dailyTotals = new Map()
  for (const sale of sales) {
    const day = dayKey(sale.fecha)
    dailyTotals.set(day, (dailyTotals.get(day) || 0) + Number(sale.total))
  }
  const totalFor = day => dailyTotals.get(day) || 0
  return Array.from({ length: days }, (_, index) => {
    const key = shiftDay(start, index)
    const value = totalFor(key)
    const window = Math.min(index + 1, 3)
    let windowTotal = value
    for (let offset = 1; offset < window; offset += 1) windowTotal += totalFor(shiftDay(key, -offset))
    return { key, label: days === 7 ? chartDate.format(new Date(key)) : key.slice(8), value, trend: windowTotal / window }
  })
}

const noActivity = { units: 0, recent: 0, days: new Set() }

export function forecast(products, sales, lines, movements, today = limaToday()) {
  const datesBySale = new Map(sales.map(sale => [sale.id, dayKey(sale.fecha)]))
  const historyStart = shiftDay(today, -78)
  const recentStart = shiftDay(today, -14)
  const salesByProduct = new Map()
  const movementsByProduct = new Map()

  function add(collection, productId, day, quantity) {
    if (!day || day < historyStart || day >= today) return
    const totals = collection.get(productId) || { units: 0, recent: 0, days: new Set() }
    totals.units += Number(quantity)
    if (day >= recentStart) totals.recent += Number(quantity)
    totals.days.add(day)
    collection.set(productId, totals)
  }
  for (const line of lines) {
    add(salesByProduct, line.producto_id, datesBySale.get(line.venta_id), line.cantidad)
  }
  for (const movement of movements) {
    if (movement.tipo_movimiento === 'SALIDA_VENTA' && datesBySale.has(movement.venta_id)) {
      add(movementsByProduct, movement.producto_id, dayKey(movement.fecha), movement.cantidad)
    }
  }
  return products.filter(product => product.activo).map(product => {
    const sold = salesByProduct.get(product.id) || noActivity
    const moved = movementsByProduct.get(product.id) || noActivity
    const historicalUnits = Math.max(sold.units, moved.units)
    const recentUnits = Math.max(sold.recent, moved.recent)
    const activeDays = Math.max(sold.days.size, moved.days.size)
    // A common denominator keeps the 40% and 60% weights exact before rounding up.
    const weightedUnits = historicalUnits * 14 + recentUnits * 117
    const daily = weightedUnits / 2730
    const lead = Math.max(1, Number(product.lead_time_dias || 0))
    const weeklyDemand = Math.ceil(weightedUnits * 7 / 2730)
    const leadDemand = Math.ceil(weightedUnits * lead / 2730)
    const target = Math.max(1, Number(product.stock_minimo)) + leadDemand
    const order = Math.max(0, target - product.stock_actual)
    const cost = Math.round(order * Math.round(Number(product.costo_promedio) * 100)) / 100
    const coverage = daily > 0 ? product.stock_actual / daily : product.stock_actual > 0 ? 999 : 0
    const urgent = product.stock_actual <= target
    const confidence = !historicalUnits ? 'Sin historial' : activeDays >= 20 ? 'Alta' : activeDays >= 8 ? 'Media' : 'Baja'
    return { ...product, daily, lead, order, target, cost, coverage, urgent, confidence, historicalUnits,
      activeDays, weeklyDemand, leadDemand, leadCorrected: !(product.lead_time_dias > 0), consistent: sold.units === moved.units }
  }).sort((first, second) => Number(second.urgent) - Number(first.urgent) || first.coverage - second.coverage || second.cost - first.cost)
}
