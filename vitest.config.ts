import { defineConfig } from "vitest/config";

// 화면 쪽 순수 로직 시험 (DOM 없이). 엔진 시험은 node-sidecar 에서 따로 돈다
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
