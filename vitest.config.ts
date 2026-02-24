import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}"],
    exclude: ["node_modules", "build"],
    setupFiles: ["./tests/setup.ts"],
  },
});
