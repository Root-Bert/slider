import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const apiTarget = process.env.SLIDER_API_URL ?? 'http://localhost:8787';

/** Where speaking to the AI finds the pause detector's files (`VAD_BASE` in `voice/lib/vad`). */
const VAD_BASE = '/vad/';

/**
 * The files the pause detector loads by name at run time – Silero's model, its audio worklet and
 * onnxruntime's WebAssembly: served from the packages while developing, copied into the build
 * under `/vad/` (fixed names, so the server revalidates them like the other files of `public`).
 */
function vadAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const vadDir = path.dirname(require.resolve('@ricky0123/vad-web'));
  const ortDir = path.dirname(require.resolve('onnxruntime-web/wasm'));
  const files: Record<string, string> = {
    'vad.worklet.bundle.min.js': path.join(vadDir, 'vad.worklet.bundle.min.js'),
    'silero_vad_v5.onnx': path.join(vadDir, 'silero_vad_v5.onnx'),
    'ort-wasm-simd-threaded.mjs': path.join(ortDir, 'ort-wasm-simd-threaded.mjs'),
    'ort-wasm-simd-threaded.wasm': path.join(ortDir, 'ort-wasm-simd-threaded.wasm'),
  };
  const types: Record<string, string> = {
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.wasm': 'application/wasm',
    '.onnx': 'application/octet-stream',
  };
  return {
    name: 'slider-vad-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url?.split('?')[0] ?? '';
        if (!url.startsWith(VAD_BASE)) return next();
        const source = files[url.slice(VAD_BASE.length)];
        if (!source) return next();
        response.setHeader(
          'Content-Type',
          types[path.extname(source)] ?? 'application/octet-stream',
        );
        response.end(readFileSync(source));
      });
    },
    generateBundle() {
      for (const [name, source] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName: `vad/${name}`, source: readFileSync(source) });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), vadAssets()],
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': apiTarget,
      '/files': apiTarget,
    },
  },
});
