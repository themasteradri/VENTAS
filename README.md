# Control · Sistema de ventas

Interfaz React, API en Vercel Functions y datos en SQLite local o Turso. La API determina la empresa a partir de la sesión y limita las operaciones a esa empresa. Los superusuarios pueden cambiar de empresa y administrar cuentas.

## Ejecutar en local

Usa Node.js 22.13 o posterior y ejecuta desde este repositorio:

```powershell
npm ci
npm run db:local
npm run dev -- --host 127.0.0.1
```

`db:local` crea `control.local.sqlite3` a partir de `../sistema-ventas/db.sqlite3` en modo de solo lectura. Conserva las cuentas y los datos comerciales, elimina las sesiones antiguas de Django de la copia y se detiene si el archivo de destino ya existe. Si el original está en otra carpeta, pásalo como argumento a `npm run db:local -- RUTA`. Las escrituras de React se guardan en la copia local.

Vite ejecuta localmente el mismo manejador de `api/handler.js` que usa Vercel. Entra con tus credenciales de Django. No hace falta iniciar Django ni abrir el archivo desde el navegador. Para una vista de producción local, ejecuta `npm run build` y `npm run preview -- --host 127.0.0.1`.

## Desplegar en Vercel

1. En Turso, importa una **copia de la base** mediante `turso db create control --from-file ./control.local.sqlite3`.
2. Importa este repositorio en Vercel con el preset Vite. Configura `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` como variables del servidor. Conecta cada entorno a su base correspondiente.
3. Verifica acceso, permisos y una venta de prueba con una base de pruebas antes de usar la base principal. El primer arranque de la API crea las tablas de sesión y control de duplicados.

Los archivos SQLite y los secretos se excluyen del repositorio y del despliegue. Las boletas son comprobantes internos en PDF.
