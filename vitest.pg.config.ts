import { defineConfig } from 'vitest/config';

// La misma suite, pero contra PostgreSQL por red con el driver pg (ver tests/pg-wire.setup.ts).
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], setupFiles: ['tests/pg-wire.setup.ts'], testTimeout: 120_000, hookTimeout: 120_000 } });
