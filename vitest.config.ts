import { defineConfig } from "vitest/config";

// Node environment: the storage primitives are exercised against fakes
// (fake-indexeddb for IndexedDB, an in-memory OPFS shim) rather than a real
// browser. crypto.subtle and Blob are available on the Node global.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
