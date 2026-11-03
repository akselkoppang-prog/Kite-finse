import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' så bygget fungerer både lokalt, på GitHub Pages og fra en vilkårlig undermappe.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { chunkSizeWarningLimit: 2500 },
});
