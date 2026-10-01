import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  root: "src/web",
  plugins: [preact()],
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    // WeChat's in-app browser lags behind current Chrome.
    target: "es2019",
  },
});
