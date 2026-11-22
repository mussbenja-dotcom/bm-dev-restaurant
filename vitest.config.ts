import { defineConfig } from 'vitest/config';

// Separado de vite.config.ts (root: web) para que encuentre tests/.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], testTimeout: 60_000 } });
