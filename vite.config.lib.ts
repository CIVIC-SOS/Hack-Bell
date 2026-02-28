import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    react(),
    dts({
      tsconfigPath: './tsconfig.app.json',
      rollupTypes: true,
      insertTypesEntry: true,
    }),
  ],
  worker: {
    format: 'es',
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/lib.ts'),
      name: 'SecureRedact',
      formats: ['es', 'umd'],
      fileName: (format) => `secure-redact.${format}.js`,
    },
    rollupOptions: {
      // Externalize React — consumers provide their own
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'jsxRuntime',
        },
        // Ensure CSS is extracted to style.css
        assetFileNames: (assetInfo) => {
          if (assetInfo.names?.[0]?.endsWith('.css')) return 'style.css';
          return assetInfo.names?.[0] ?? 'assets/[name]-[hash][extname]';
        },
      },
    },
    sourcemap: true,
    minify: 'esbuild',
    cssCodeSplit: false,
  },
});
