import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity, ArrowDownUp, BarChart3, Building2, ChevronDown, CircleDollarSign,
  ClipboardList, Download, LayoutDashboard, LogOut, Menu, Package, Plus, Search,
  ShoppingBag, TrendingUp, Users, X,
} from 'lucide-react'
import { dailyIncome, dateLabel, dayKey, forecast, limaToday, money, recordsInRange, shiftDay, sum } from './data'
import { ActionForm, api, BulkInventory, downloadReceipt, Login, SalesExport } from './workflows'
import './styles.css'

const navigation = [
  ['resumen', 'Resumen', LayoutDashboard, 'Indicadores de ventas e inventario.'],
  ['ventas', 'Ventas', ShoppingBag, 'Consulta el historial y el detalle de cada venta.'],
  ['inventario', 'Inventario', Package, 'Consulta el catálogo, los precios y las existencias.'],
  ['operaciones', 'Operaciones', ArrowDownUp, 'Consulta las entradas y salidas registradas en el Kardex.'],
  ['finanzas', 'Finanzas', CircleDollarSign, 'Revisa los ingresos, los gastos y el valor del inventario.'],
  ['pronostico', 'Pronóstico', TrendingUp, 'Estima la demanda y las unidades que conviene reponer.'],
  ['usuarios', 'Usuarios', Users, 'Administra las cuentas y sus empresas.'],
]
const labels = { EFECTIVO: 'Efectivo', TARJETA: 'Tarjeta', DIGITAL: 'Digital', TRANSFERENCIA: 'Transferencia', ENTRADA_COMPRA: 'Entrada por compra', SALIDA_VENTA: 'Salida por venta', AJUSTE: 'Ajuste' }
const label = value => labels[value] || String(value || '—').toLowerCase().replaceAll('_', ' ')
const stockState = product => !product.activo ? 'Archivado' : product.stock_actual <= 0 ? 'Agotado' : product.stock_actual <= product.stock_minimo ? 'Stock bajo' : 'Disponible'
const stockTone = { Disponible: 'good', 'Stock bajo': 'amber', Agotado: 'warn', Archivado: 'neutral' }
const integer = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 })
const decimal = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 })
const confidenceTone = { Alta: 'good', Media: 'amber', Baja: 'warn', 'Sin historial': 'neutral' }
const tableColumns = {
  ventas: [['Ticket', sale => sale.numero_ticket || `#${sale.id}`], ['Fecha', sale => dateLabel(sale.fecha)], ['Pago', sale => label(sale.metodo_pago)], ['Importe', sale => money(sale.total)]],
  inventario: [['Producto', row => row.nombre], ['Categoría', row => row.categoria || '—'], ['Stock', row => row.stock_actual], ['Precio', row => money(row.precio_venta)], ['Estado', row => <span className={`badge ${stockTone[stockState(row)]}`}>{stockState(row)}</span>]],
  operaciones: [['Producto', row => row.producto || '—'], ['Movimiento', row => label(row.tipo_movimiento)], ['Fecha', row => dateLabel(row.fecha)], ['Unidades', row => row.cantidad], ['Stock final', row => row.stock_resultante]],
  finanzas: [['Concepto', row => row.descripcion], ['Categoría', row => row.categoria], ['Fecha', row => dateLabel(row.fecha)], ['Importe', row => money(row.monto)]],
  pronostico: [
    ['Producto', row => row.nombre], ['Stock', row => row.stock_actual], ['Demanda a 7 días', row => row.weeklyDemand],
    ['Cobertura (días)', row => decimal.format(row.coverage)], ['Reposición', row => row.order],
    ['Confianza', row => <span className={`badge ${confidenceTone[row.confidence]}`}>{row.confidence}</span>],
    ['Estado', row => <span className={`badge ${row.urgent ? 'warn' : 'good'}`}>{row.urgent ? 'Reponer ahora' : 'Stock cubierto'}</span>],
  ],
  usuarios: [['Usuario', row => row.username], ['Nombre', row => [row.first_name, row.last_name].filter(Boolean).join(' ') || '—'], ['Empresa', row => row.empresa || '—'], ['Rol', row => row.is_superuser ? 'Superusuario' : row.is_staff ? 'Administrador' : 'Usuario'], ['Estado', row => row.is_active ? 'Activo' : 'Inactivo']],
}

function AnimatedValue({ value, format }) {
  const current = useRef(0)
  const [visible, setVisible] = useState(0)
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame
    function finish() {
      cancelAnimationFrame(frame)
      current.current = value
      setVisible(value)
    }
    function preferenceChanged(event) {
      if (event.matches) finish()
    }
    const start = current.current
    if (preference.matches || start === value) {
      finish()
      return
    }
    let startedAt
    function tick(timestamp) {
      startedAt ??= timestamp
      const progress = Math.min((timestamp - startedAt) / 700, 1)
      current.current = progress === 1 ? value : start + (value - start) * (1 - (1 - progress) ** 3)
      setVisible(current.current)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    preference.addEventListener('change', preferenceChanged)
    return () => {
      cancelAnimationFrame(frame)
      preference.removeEventListener('change', preferenceChanged)
    }
  }, [value])
  return <strong><span aria-hidden="true">{format(visible)}</span><span className="sr-only">{format(value)}</span></strong>
}

function Metrics({ cards }) {
  return <div className="metrics">{cards.map(([title, value, Icon, tone, note, format = integer.format]) =>
    <article className="metric" key={title}>
      <span className={`metric-icon ${tone}`}><Icon size={15} /></span>
      <span className="metric-label">{title}</span>
      <AnimatedValue value={value} format={format} />
      <small>{note}</small>
    </article>,
  )}</div>
}

function Table({ rows, columns, onDetail, emptyText }) {
  return rows.length ? <div className="table-scroll"><table>
    <thead><tr>{columns.map(([name]) => <th scope="col" key={name}>{name}</th>)}{onDetail && <th scope="col">Acción</th>}</tr></thead>
    <tbody>{rows.map(row => <tr key={row.id}>
      {columns.map(([name, render]) => <td key={name}>{render(row)}</td>)}
      {onDetail && <td><button className="text-button" aria-label={`Ver detalle de ${row.nombre || row.producto || row.numero_ticket || row.descripcion || row.id}`} onClick={() => onDetail(row)}>Ver detalle</button></td>}
    </tr>)}</tbody>
  </table></div> : <div className="empty-table">{emptyText}</div>
}

function Records({ rows, section, title, onDetail, action, onBulk, categories, initialDates }) {
  const [query, setQuery] = useState('')
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(1)
  const [startDate, setStartDate] = useState(initialDates?.start || '')
  const [endDate, setEndDate] = useState(initialDates?.end || '')
  const [category, setCategory] = useState('')
  const [stock, setStock] = useState('')
  const invalidDates = Boolean(startDate && endDate && startDate > endDate)
  const dated = invalidDates ? [] : recordsInRange(rows, startDate, endDate)
  const scoped = category || stock ? dated.filter(row => (!category || String(row.categoria_id) === category) && (!stock || stockState(row) === stock)) : dated
  const searchText = query.trim().toLocaleLowerCase('es-PE')
  const filtered = scoped.filter(row => [row.nombre, row.producto, row.categoria, row.numero_ticket, row.codigo_barras, row.descripcion, row.username, row.first_name, row.last_name, row.empresa, label(row.metodo_pago), label(row.tipo_movimiento)].some(value =>
    value != null && String(value).toLocaleLowerCase('es-PE').includes(searchText),
  ))
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const start = (currentPage - 1) * pageSize
  const visible = filtered.slice(start, start + pageSize)
  const editable = onBulk && visible.filter(product => product.activo).slice(0, 20)
  function changeFilter(set) {
    return event => { set(event.target.value); setPage(1) }
  }
  function clearFilters() {
    setQuery('')
    setStartDate('')
    setEndDate('')
    setCategory('')
    setStock('')
    setPage(1)
  }
  return <section className="panel">
    <div className="panel-header table-header">
      <div><h2>{title}</h2><p>{filtered.length === rows.length ? `${rows.length} registros` : `${filtered.length} de ${rows.length} registros`}</p></div>
      <div className="table-toolbar"><label className="search"><Search size={17} /><input aria-label="Buscar registros" value={query} placeholder="Buscar registros" onChange={changeFilter(setQuery)} /></label>
        {Boolean(editable?.length) && <button className="secondary" onClick={() => onBulk(editable)}>Editar por lote</button>}{action}</div>
    </div>
    {(section === 'ventas' || section === 'inventario') && <div className="table-filters" role="group" aria-label={section === 'ventas' ? 'Filtros de ventas' : 'Filtros de inventario'}>
      {section === 'ventas' ? <>
        <label>Desde<input type="date" value={startDate} max={endDate || undefined} onChange={changeFilter(setStartDate)} /></label>
        <label>Hasta<input type="date" value={endDate} min={startDate || undefined} onChange={changeFilter(setEndDate)} /></label>
      </> : <>
        <label>Categoría<select aria-label="Categoría" value={category} onChange={changeFilter(setCategory)}>
          <option value="">Todas las categorías</option>{categories.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}
        </select></label>
        <label>Estado del stock<select aria-label="Estado del stock" value={stock} onChange={changeFilter(setStock)}>
          <option value="">Todos los estados</option>{Object.keys(stockTone).map(state => <option key={state}>{state}</option>)}
        </select></label>
      </>}
      {(query || startDate || endDate || category || stock) && <button className="text-button" onClick={clearFilters}>Limpiar filtros</button>}
      {invalidDates && <p role="alert">La fecha desde debe ser anterior o igual a la fecha hasta.</p>}
    </div>}
    <Table rows={visible} columns={tableColumns[section]} onDetail={onDetail}
      emptyText={invalidDates ? 'Corrige el rango para ver las ventas.' : 'No se encontraron registros.'} />
    <div className="table-footer">
      <span aria-live="polite">{filtered.length ? `${start + 1}–${Math.min(start + pageSize, filtered.length)} de ${filtered.length}` : '0 registros'}</span>
      <div className="pagination">
        <label>Por página <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1) }}><option>10</option><option>20</option><option>50</option></select></label>
        <button onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1}>Anterior</button>
        <button onClick={() => setPage(currentPage + 1)} disabled={currentPage === totalPages}>Siguiente</button>
      </div>
    </div>
  </section>
}

function StockChart({ products, forecasts, categories }) {
  const [chartType, setChartType] = useState('bar')
  const [measure, setMeasure] = useState('stock')
  const [category, setCategory] = useState('')
  const forecastById = new Map(forecasts.map(row => [row.id, row]))
  const values = products.filter(row => row.activo && (!category || String(row.categoria_id) === category)).map(row => ({
    id: row.id,
    name: row.nombre,
    value: measure === 'stock' ? Number(row.stock_actual) : Number(forecastById.get(row.id)?.order || 0),
  })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'es'))
    .slice(0, 10)
  const max = Math.max(1, ...values.map(row => row.value))
  return <section className="panel stock-chart-panel">
    <div className="panel-header stock-chart-header"><div><h2>Existencias y reposición</h2><p>{measure === 'stock' ? 'Unidades disponibles ahora' : 'Unidades sugeridas para reponer'} · hasta 10 productos</p></div>
      <div className="stock-chart-controls">
        <label>Visualización<select aria-label="Tipo de gráfico" value={chartType} onChange={event => setChartType(event.target.value)}><option value="bar">Columnas</option><option value="horizontal">Barras horizontales</option></select></label>
        <label>Unidades<select aria-label="Unidades del gráfico" value={measure} onChange={event => setMeasure(event.target.value)}><option value="stock">Stock actual</option><option value="order">A reponer</option></select></label>
        <label>Categoría<select aria-label="Categoría del gráfico" value={category} onChange={event => setCategory(event.target.value)}><option value="">Todas</option>{categories.map(row => <option key={row.id} value={row.id}>{row.nombre}</option>)}</select></label>
      </div>
    </div>
    {values.length ? chartType === 'bar' ? <div className="stock-chart" aria-label={`Gráfico de columnas: ${measure === 'stock' ? 'stock actual' : 'unidades a reponer'}`}>
      <div className="stock-chart-scale" aria-hidden="true">{[max, Math.round(max * .5), 0].map((tick, index) => <span style={{ top: `${index * 50}%` }} key={index}>{tick}</span>)}</div>
      <div className="stock-chart-plot" style={{ '--stock-count': values.length }}>
        <div className="stock-chart-gridlines" aria-hidden="true"><i /><i /><i /></div>
        {values.map(row => <div className="stock-chart-item" key={row.id}>
          <div className="stock-chart-track"><div className={`stock-chart-value ${row.value ? '' : 'is-zero'}`} tabIndex={0} role="img" aria-label={`${row.name}: ${row.value} unidades`} style={{ '--stock-height': `${row.value / max * 100}%` }}><span className="stock-value-detail">{row.name}: {row.value} unidades</span><span className="stock-value-label">{row.value}</span></div></div>
          <span className="stock-chart-name" title={row.name}>{row.name}</span>
        </div>)}
      </div>
    </div> : <div className="stock-horizontal-chart" aria-label={`Gráfico de barras horizontales: ${measure === 'stock' ? 'stock actual' : 'unidades a reponer'}`}>
      {values.map(row => <div className="stock-horizontal-row" key={row.id}>
        <span className="stock-horizontal-name" title={row.name}>{row.name}</span>
        <div className="stock-horizontal-track"><div className="stock-horizontal-value" tabIndex={0} role="img" aria-label={`${row.name}: ${row.value} unidades`} style={{ width: `${row.value / max * 100}%` }}><span className="stock-value-detail">{row.name}: {row.value} unidades</span></div></div>
        <strong>{row.value}</strong>
      </div>)}
    </div> : <div className="empty-chart"><BarChart3 size={28} /><p>No hay productos activos para esta categoría.</p></div>}
  </section>
}

const dashboardDays = 7

function Dashboard({ sales, lines, products, movements, cutoff, onCutoff, onSection, onDetail }) {
  const today = limaToday()
  const latestSale = sales.find(sale => sale.fecha && dayKey(sale.fecha) <= today)
  const latestSaleDay = dayKey(latestSale?.fecha)
  const currentWeekStart = shiftDay(today, 1 - dashboardDays)
  const historicalDefault = Boolean(!cutoff && latestSaleDay && latestSaleDay < currentWeekStart)
  const end = cutoff || (historicalDefault ? latestSaleDay : today)
  const start = shiftDay(end, 1 - dashboardDays)
  const salesInRange = recordsInRange(sales, start, end)
  const movementsInRange = recordsInRange(movements, start, end)
  const saleIds = new Set(salesInRange.map(sale => sale.id))
  const unitsSold = sum(lines.filter(line => saleIds.has(line.venta_id)), 'cantidad')
  const income = sum(salesInRange, 'total')
  const chart = dailyIncome(salesInRange, start, dashboardDays)
  const max = Math.max(1, ...chart.map(point => Math.max(point.value, point.trend)))
  const trendPoints = chart.map(({ trend }, index) => `${(index + .5) * 100 / chart.length},${100 - 100 * trend / max}`).join(' ')
  const active = products.filter(product => product.activo)
  return <>
    <div className="dashboard-period" role="group" aria-label="Período del resumen">
      <div><strong>{historicalDefault ? '7 días hasta la última venta' : 'Resumen de 7 días'}</strong><p>{dateLabel(start)} – {dateLabel(end)}</p></div>
      <div className="period-controls">
        <label>Fecha de corte<input type="date" value={end} max={today} onChange={event => { if (event.target.validity.valid) onCutoff(event.target.value) }} /></label>
        {end !== today && <button className="text-button" onClick={() => onCutoff(today)}>Ver semana actual</button>}
      </div>
    </div>
    <div className="dashboard-grid">
      <div className="dashboard-summary">
        <Metrics cards={[
          ['Ingresos', income, CircleDollarSign, 'teal', 'Total del período', money],
          ['Ventas', salesInRange.length, ShoppingBag, 'teal', 'Transacciones registradas'],
          ['Unidades vendidas', unitsSold, Package, 'teal', 'Unidades en las ventas'],
          ['Movimientos', movementsInRange.length, Activity, 'teal', 'Entradas y salidas del Kardex'],
        ]} />
        <section className="panel stock-panel">
          <div className="panel-header"><div><h2>Estado actual del inventario</h2><p>{active.length} productos activos por nivel de stock</p></div></div>
          <div className="stock-list">{['Disponible', 'Stock bajo', 'Agotado'].map((state, index) => {
            const count = active.filter(product => stockState(product) === state).length
            return <div key={state}><div className="stock-label"><span><i className={`stock-dot tone-${index}`} />{state}</span><strong>{count}</strong></div>
              <div className="progress">{count > 0 && <div className={`tone-${index}`} key={`${count}:${active.length}`} style={{ width: `${count / active.length * 100}%`, '--chart-delay': `${index * 75}ms` }} />}</div>
            </div>
          })}</div>
        </section>
      </div>
      <section className="panel income-panel">
        <div className="panel-header chart-header"><div><h2>Ingresos por día</h2><p>Promedio diario <strong>{money(income / dashboardDays)}</strong></p></div>
          {salesInRange.length > 0 && <div className="legend"><span className="legend-income">Ingresos</span><span className="legend-trend">Promedio móvil de 3 días</span></div>}
        </div>
        {salesInRange.length ? <div className="chart-layout">
          <div className="chart-scale" aria-hidden="true">{[1, .75, .5, .25, 0].map(tick => <span key={tick}>{money(max * tick)}</span>)}</div>
          <div className="chart" aria-label="Ingresos diarios" style={{ '--chart-days': dashboardDays }}>{chart.map((point, index) => <div className={`bar-group ${index >= chart.length * .75 ? 'chart-end' : index < chart.length * .25 ? 'chart-start' : ''}`} key={point.key}>
            <div className="bar-track"><div tabIndex={0} role="img" aria-label={`${dateLabel(point.key)}, ingresos ${money(point.value)}, tendencia ${money(point.trend)}`} className={point.value ? 'bar' : 'bar bar-zero'} key={`${point.value}:${max}`} style={{ height: point.value ? `${point.value / max * 100}%` : '8px', '--chart-delay': `${Math.min(index * 30, 240)}ms` }}>
              <span className="chart-tooltip" aria-hidden="true">{dateLabel(point.key)}<br />Ingresos {money(point.value)}<br />Tendencia {money(point.trend)}</span>
            </div></div>
            <div className="bar-label" aria-hidden="true">{point.label}</div>
          </div>)}
            <svg className="trend-line" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" key={trendPoints}>
              <polyline points={trendPoints} vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
        </div> : <div className="empty-chart"><BarChart3 size={31} />
          <div>
            <p>{sales.length ? 'No hay ventas en el período seleccionado.' : 'Esta empresa todavía no tiene ventas registradas.'}</p>
            {latestSaleDay && <button className="text-button" onClick={() => onCutoff(latestSaleDay)}>Ver semana de la última venta</button>}
          </div>
        </div>}
      </section>
    </div>
    <section className="panel"><div className="panel-header"><div><h2>Ventas recientes</h2><p>Últimas operaciones del período seleccionado</p></div>
      <button className="text-button" onClick={() => onSection({ start, end })}>Ver ventas del período</button></div>
      <Table rows={salesInRange.slice(0, 5)} columns={tableColumns.ventas} onDetail={row => onDetail('ventas', row)} emptyText="No hay ventas en el período seleccionado." />
    </section>
  </>
}

function Details({ detail, data, onClose, onAction }) {
  const dialog = useRef(null)
  const [receiptError, setReceiptError] = useState('')
  useEffect(() => { dialog.current.showModal() }, [])
  const { section, row } = detail
  const saleLines = section === 'ventas' ? data.lines.filter(line => line.venta_id === row.id) : []
  const facts = {
    ventas: [['Fecha', dateLabel(row.fecha)], ['Método de pago', label(row.metodo_pago)], ['Total', money(row.total)]],
    inventario: [['Código de barras', row.codigo_barras || '—'], ['Categoría', row.categoria || '—'], ['Stock disponible', row.stock_actual], ['Stock mínimo', row.stock_minimo], ['Precio de venta', money(row.precio_venta)], ['Costo promedio', money(row.costo_promedio)], ['Catálogo', row.activo ? 'Activo' : 'Inactivo']],
    operaciones: [['Fecha', dateLabel(row.fecha)], ['Movimiento', label(row.tipo_movimiento)], ['Cantidad', row.cantidad], ['Stock resultante', row.stock_resultante], ['Costo unitario', money(row.costo_unitario)], ['Ticket', row.numero_ticket || '—']],
    finanzas: [['Fecha', dateLabel(row.fecha)], ['Categoría', row.categoria], ['Importe', money(row.monto)]],
    pronostico: [
      ['Stock actual', row.stock_actual], ['Unidades vendidas en 78 días', row.historicalUnits],
      ['Demanda diaria', decimal.format(row.daily)], ['Demanda en 7 días', row.weeklyDemand],
      ['Plazo de entrega', row.leadCorrected ? '1 día (valor por defecto)' : `${row.lead} días`],
      ['Demanda durante el plazo', row.leadDemand], ['Punto de reorden', row.target],
      ['Reposición sugerida', row.order], ['Costo de reposición', money(row.cost)], ['Días de cobertura', decimal.format(row.coverage)],
      ['Confianza', row.confidence], ['Días con movimiento', row.activeDays],
      ['Estado', row.urgent ? 'Reponer ahora' : 'Stock cubierto'],
      ['Ventas y Kardex', row.consistent ? 'Cantidades coincidentes' : 'Cantidades diferentes'],
    ],
  }
  return <dialog ref={dialog} className="dialog" aria-labelledby="detail-title" onClose={onClose}>
    <div className="dialog-body">
      <div className="dialog-header"><div><p>Detalle del registro</p><h2 id="detail-title">{row.nombre || row.producto || row.numero_ticket || row.descripcion || `Registro #${row.id}`}</h2></div>
        <button className="icon-button" aria-label="Cerrar detalle" onClick={() => dialog.current.close()}><X size={22} /></button></div>
      <dl>{facts[section].map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
      {Boolean(row.es_simulado) && <span className="badge violet">Dato simulado</span>}
      {section === 'ventas' && <><h3>Productos vendidos</h3><Table rows={saleLines}
        columns={[[ 'Producto', line => line.producto || '—'], ['Cantidad', line => line.cantidad], ['Importe', line => money(line.precio_unitario * line.cantidad)]]} emptyText="Esta venta no tiene líneas registradas." /></>}
      {receiptError && <p className="error" role="alert">{receiptError}</p>}
      <div className="dialog-actions">
        {section === 'ventas' && <button className="primary" onClick={() => downloadReceipt(row, saleLines, data.company).catch(() => setReceiptError('No se pudo generar la boleta.'))}><Download size={16} /> Boleta PDF</button>}
        {section === 'inventario' && <>
          {Boolean(row.activo) && <button className="secondary" onClick={() => onAction('stock', row)}>Ajustar stock</button>}
          <button className="secondary" onClick={() => onAction('remove', row)}>Retirar producto</button>
          <button className="primary" onClick={() => onAction('product', row)}>Editar producto</button>
        </>}
      </div>
    </div>
  </dialog>
}

function readSection() {
  const section = window.location.hash.slice(1)
  return navigation.some(([key]) => key === section) ? section : 'resumen'
}

function ModuleNav({ items, section, onNavigate }) {
  const mobileMenu = useRef(null)
  function closeMenu(focus = false) {
    if (mobileMenu.current?.open) {
      mobileMenu.current.open = false
      if (focus) mobileMenu.current.querySelector('summary').focus()
    }
  }
  function links(mobile) {
    return items.map(([key, name, Icon]) =>
      <a key={key} href={`#${key}`} aria-current={key === section ? 'page' : undefined} onClick={() => {
        onNavigate(key)
        if (mobile) closeMenu(true)
      }}><Icon size={19} />{name}</a>,
    )
  }
  return <>
    <nav className="desktop-nav" aria-label="Módulos">{links(false)}</nav>
    <details className="mobile-nav" ref={mobileMenu} onKeyDown={event => {
      if (event.key === 'Escape') closeMenu(true)
    }}>
      <summary><Menu size={18} /> Módulos <ChevronDown size={16} /></summary>
      <nav aria-label="Módulos">{links(true)}</nav>
    </details>
  </>
}

function Workspace({ data, company, onCompany, onRefresh, onLogout, loading }) {
  const [tab, setTab] = useState(readSection)
  const [detail, setDetail] = useState(null)
  const [action, setAction] = useState(null)
  const [notice, setNotice] = useState('')
  const [period, setPeriod] = useState('')
  const [dashboardCutoff, setDashboardCutoff] = useState('')
  const [salesDates, setSalesDates] = useState(null)
  useEffect(() => {
    function syncSection() { setTab(readSection()); setDetail(null); setNotice('') }
    window.addEventListener('hashchange', syncSection)
    return () => window.removeEventListener('hashchange', syncSection)
  }, [])
  const { user, sales, products, movements, expenses, lines } = data
  const visibleNavigation = navigation.filter(([key]) => key !== 'usuarios' || user.is_superuser)
  const section = tab === 'usuarios' && !user.is_superuser ? 'resumen' : tab
  const today = limaToday()
  const forecasts = useMemo(() => forecast(products, sales, lines, movements, today), [products, sales, lines, movements, today])
  const selectedSales = period ? sales.filter(row => dayKey(row.fecha).startsWith(period)) : sales
  const selectedExpenses = period ? expenses.filter(row => row.fecha.startsWith(period)) : expenses
  const selectedSaleIds = new Set(selectedSales.map(row => row.id))
  const saleCost = movements.filter(row => row.tipo_movimiento === 'SALIDA_VENTA' && selectedSaleIds.has(row.venta_id)).reduce((total, row) => total + row.cantidad * row.costo_unitario, 0)
  const [, title, , description] = navigation.find(([key]) => key === section)
  const openDetail = (current, row) => setDetail({ section: current, row })
  const rows = { ventas: sales, inventario: products, operaciones: movements, finanzas: selectedExpenses, pronostico: forecasts, usuarios: data.users }
  const tableTitles = { ventas: 'Historial de ventas', inventario: 'Catálogo de productos', operaciones: 'Movimientos de Kardex', finanzas: 'Gastos operativos', pronostico: 'Reposición por producto', usuarios: 'Cuentas del sistema' }
  const newActions = { ventas: ['sale', 'Registrar venta'], inventario: ['product', 'Nuevo producto'], finanzas: ['expense', 'Registrar gasto'], usuarios: ['user', 'Nuevo usuario'] }
  const newAction = newActions[section]
  function showPeriodSales(dates) {
    setSalesDates(dates)
    window.location.hash = 'ventas'
  }
  function openAction(mode, row) {
    setDetail(null)
    setNotice('')
    setAction({ mode, row })
  }
  function saved(result, mode) {
    setAction(null)
    setNotice(mode === 'sale' ? `Venta ${result.numero_ticket} registrada.` : result.archived ? 'Producto archivado.' : 'Cambios guardados.')
    onRefresh()
  }
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#resumen"><span className="brand-mark"><ClipboardList size={23} /></span><span><strong>Control</strong><small>Sistema de ventas</small></span></a>
      <ModuleNav items={visibleNavigation} section={section} onNavigate={key => {
        if (key === 'ventas') setSalesDates(null)
      }} />
      <div className="sidebar-status"><Users size={17} /><div><strong>{user.username}</strong><small>{user.is_superuser ? 'Superusuario' : 'Usuario'}</small></div></div>
    </aside>
    <main>
      <header className="topbar">
        <label className="company"><Building2 size={18} /><select aria-label="Empresa" disabled={!user.is_superuser || !data.companies.length} value={company || data.company?.id || ''} onChange={event => { setNotice(''); setDetail(null); setPeriod(''); setSalesDates(null); setDashboardCutoff(''); onCompany(event.target.value) }}>{data.companies.length ? data.companies.map(row => <option value={row.id} key={row.id}>{row.nombre}</option>) : <option value="">Sin empresa</option>}</select><ChevronDown size={15} /></label>
        <button className="secondary" onClick={() => openAction('password')}>Contraseña</button>
        <button className="secondary logout" onClick={onLogout}><LogOut size={17} /> Salir</button>
      </header>
      <div className="content">
        <header className="page-header"><h1>{title}</h1><p>{description}</p></header>
        {notice && <p role="status" className="success">{notice}</p>}
        {!data.company && <p role="status" className="error">Tu cuenta todavía no tiene una empresa asignada.</p>}
        {loading ? <p role="status" className="panel loading">Cargando datos…</p> : section === 'resumen' ? <Dashboard {...{ sales, lines, products, movements }}
          cutoff={dashboardCutoff} onCutoff={setDashboardCutoff} onSection={showPeriodSales} onDetail={openDetail} /> :
          <>
            {section === 'finanzas' && <>
              <div className="finance-toolbar"><label>Mes <input type="month" value={period} onChange={event => setPeriod(event.target.value)} /></label>
                {period && <button className="text-button" onClick={() => setPeriod('')}>Ver todo el historial</button>}
                <button className="secondary" onClick={() => openAction('export')}><Download size={16} /> Exportar ventas</button>
                {data.company && <button className="secondary" onClick={() => openAction('company', data.company)}>Editar empresa</button>}
                {data.company && <button className="secondary" onClick={() => openAction('reset', data.company)}>Reiniciar datos</button>}
              </div>
              <Metrics cards={[
                ['Ingresos', sum(selectedSales, 'total'), CircleDollarSign, 'blue', 'Total de ventas registradas', money],
                ['Gastos operativos', sum(selectedExpenses, 'monto'), Activity, 'violet', 'Total de gastos registrados', money],
                ['Utilidad estimada', sum(selectedSales, 'total') - saleCost - sum(selectedExpenses, 'monto'), TrendingUp, 'amber', 'Usa el costo registrado en Kardex', money],
                ['Valor de inventario', products.filter(p => p.activo).reduce((total, p) => total + p.stock_actual * p.costo_promedio, 0), Package, 'teal', 'Existencias a costo promedio', money],
              ]} />
            </>}
            {section === 'pronostico' && <StockChart products={products} forecasts={forecasts} categories={data.categories} />}
            <Records key={`${section}:${data.company?.id}:${section === 'ventas' ? salesDates?.start || '' : ''}`} rows={rows[section]} section={section} title={tableTitles[section]}
              categories={data.categories} initialDates={section === 'ventas' ? salesDates : null}
              action={newAction && (data.company || section === 'usuarios') && <button className="primary" onClick={() => openAction(newAction[0])}><Plus size={17} /> {newAction[1]}</button>}
              onBulk={section === 'inventario' ? products => openAction('bulk', products) : undefined}
              onDetail={row => section === 'usuarios' ? openAction('user', row) : openDetail(section, row)} />
          </>}
      </div>
    </main>
    {detail && <Details detail={detail} data={data} onClose={() => setDetail(null)} onAction={openAction} />}
    {action?.mode === 'export' ? <SalesExport sales={sales} month={period} onClose={() => setAction(null)} /> :
      action?.mode === 'bulk' ? <BulkInventory products={action.row} company={data.company.id} onClose={() => setAction(null)} onSave={saved} /> :
      action && <ActionForm key={action.mode} action={action} data={data} onClose={() => setAction(null)} onSave={saved} onAction={openAction} />}
  </div>
}

function App() {
  const [data, setData] = useState(null)
  const [company, setCompany] = useState('')
  const [revision, setRevision] = useState(0)
  const [phase, setPhase] = useState('load')
  const [error, setError] = useState('')
  function refresh() { setRevision(value => value + 1) }
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    api('datos', { company, signal: controller.signal }).then(result => {
      setData(result)
      setPhase('ready')
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure.status === 401) {
        setData(null)
        setCompany('')
        setPhase('login')
      } else {
        setError(failure.message)
        setPhase('error')
      }
    })
    return () => controller.abort()
  }, [company, revision])
  async function logout() {
    try {
      await api('logout', { method: 'POST' })
      window.location.hash = 'resumen'
      setCompany('')
      setData(null)
      setPhase('login')
      refresh()
    } catch (failure) {
      setError(failure.message)
      setPhase('error')
    }
  }
  if (phase === 'error') return <main className="login-page"><section className="panel login-panel"><p role="alert" className="error">{error}</p><button className="primary" onClick={() => { setPhase('load'); refresh() }}>Reintentar</button></section></main>
  if (phase === 'login') return <Login onLogin={() => { setPhase('load'); refresh() }} />
  if (!data) return <main className="login-page"><p className="panel loading" role="status">Comprobando sesión…</p></main>
  return <Workspace data={data} company={company} loading={Boolean(company && Number(company) !== data.company?.id)} onCompany={setCompany} onRefresh={refresh} onLogout={logout} />
}

createRoot(document.getElementById('root')).render(<App />)
