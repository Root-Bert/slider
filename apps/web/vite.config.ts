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

/** Where the spell check finds its dictionaries (`SPELL_BASE` in `viewer/spelling`). */
const SPELL_BASE = '/spell/';

/**
 * The Hunspell dictionaries the spell check of the guides view loads at run time – German
 * (igerman98, GPL-2.0 or GPL-3.0: shipped as it is, its licence beside it) and English: served
 * from the packages while developing, copied into the build under `/spell/`.
 */
function spellAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const dir = (name: string) => path.dirname(require.resolve(name));
  const files: Record<string, string> = {
    'de.aff': path.join(dir('dictionary-de'), 'index.aff'),
    'de.dic': path.join(dir('dictionary-de'), 'index.dic'),
    'de.license.txt': path.join(dir('dictionary-de'), 'license'),
    'en.aff': path.join(dir('dictionary-en'), 'index.aff'),
    'en.dic': path.join(dir('dictionary-en'), 'index.dic'),
    'en.license.txt': path.join(dir('dictionary-en'), 'license'),
  };
  return {
    name: 'slider-spell-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url?.split('?')[0] ?? '';
        if (!url.startsWith(SPELL_BASE)) return next();
        const source = files[url.slice(SPELL_BASE.length)];
        if (!source) return next();
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.end(readFileSync(source));
      });
    },
    generateBundle() {
      for (const [name, source] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName: `spell/${name}`, source: readFileSync(source) });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), vadAssets(), spellAssets()],
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': apiTarget,
      '/files': apiTarget,
      // AI apps find how to sign in at the origin's root (MCP, OAuth).
      '/.well-known': apiTarget,
    },
  },
});
