import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({ path: ".env.local", quiet: true });

// Integration tests against the local Supabase stack (`npx supabase start`).
export default defineConfig({
  test: {
    include: ["tests/db/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
