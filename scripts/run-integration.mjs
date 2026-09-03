#!/usr/bin/env node
// Run the SQLite-backed CcSwitchStore integration test through Node's
// native test runner — `node --test test/source/cc-switch.integration.test.js`.
// `node:sqlite` is an experimental Node 22 built-in; opt in via
// `--experimental-sqlite`.
//
// Why a separate script instead of `vitest run`: vite-node's pre-bundle
// pass cannot resolve the `node:sqlite` built-in spec and refuses to
// load the cc-switch integration test at all. Node's loader resolves
// the spec directly, so the same test file runs cleanly here.

import { spawnSync } from "node:child_process";

const args = [
  "--no-warnings",
  "--experimental-sqlite",
  "--test",
  "test/source/cc-switch.integration.test.js",
];

const result = spawnSync(process.execPath, args, {
  stdio: "inherit",
  cwd: new URL("../", import.meta.url),
  shell: false,
});
if (result.error) {
  console.error("failed to spawn node:", result.error);
  process.exit(2);
}
process.exit(result.status ?? 1);
