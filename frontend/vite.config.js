import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// `npm run dev`   -> http://localhost:5173 (laptop; camera/mic work on localhost)
// `npm run phone` -> https://<your-laptop-ip>:5173 (phones need HTTPS for camera, mic and motion sensors)
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'https' ? [basicSsl()] : [])],
  server: {
    proxy: { '/api': process.env.VITE_API_TARGET || 'http://127.0.0.1:8000' },
  },
}))
