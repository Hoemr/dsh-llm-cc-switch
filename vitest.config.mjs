// Vitest config: drive every vitest test through `child_process.fork`
// (singleFork) so node built-ins the bundler dislikes (sqlite) stay
// out of vite-node's pre-bundle pass.
//
// We deliberately do NOT include the cc-switch SQLite integration test
// (`cc-switch.test.vitest.test.js`) in vitest's globs. It is run
// through `node --test --experimental-sqlite` instead — see
// `scripts/run-integration.mjs`.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "test/**/*.vitest.test.js",
    ],
    exclude: [
      "test/**/cc-switch.test.vitest.test.js",
      "node_modules/**",
    ],
    environment: "node",
    testTimeout: 15000,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
