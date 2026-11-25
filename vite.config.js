import { defineConfig } from 'vite'

function localApi() {
  const configure = server => {
    server.middlewares.use((request, response, next) => {
      if (!request.url?.startsWith('/api/')) return next()
      import('./api/handler.js').then(({ default: handler }) => handler(request, response)).catch(next)
    })
  }
  return { name: 'control-local-api', configureServer: configure, configurePreviewServer: configure }
}

export default defineConfig({
  plugins: [localApi()],
  server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/*.{sqlite,sqlite3,db}{,-wal,-shm,-journal}'] } },
})
