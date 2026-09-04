import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Unit/component tests run in jsdom with the `@` alias (mirrors vite.config.ts).
// DB integration tests (node:pg) use a separate config: vitest.integration.config.ts
// and run inside BEGIN..ROLLBACK transactions so production data is never touched.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/components/**/*.test.{ts,tsx}'],
    exclude: ['tests/integration/**', 'node_modules', 'dist'],
    css: false,
    restoreMocks: true,
  },
});
