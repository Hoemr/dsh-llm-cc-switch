// dsh-llm-cc-switch: baseURL allowlist.
//
// Defends against a CC Switch row whose `env.ANTHROPIC_BASE_URL` or
// equivalent points at an attacker-controlled host. The default
// allowlist is a small, conservative set:
//
//   http://   ws://     — dev proxies, localhost tunnels
//   https://  wss://    — production endpoints
//
// Localhost / loopback is intentionally NOT implied; an attacker can
// still bind to 127.0.0.1. Add `http://localhost` / `http://127.0.0.1`
// explicitly to the allowlist if you actually need to talk to a local
// relay — at your own risk.

import { URL } from "node:url";

const DEFAULT_SCHEMES = Object.freeze(["http:", "https:", "ws:", "wss:"]);

/**
 * Returns true when `raw` passes the allowlist. Failures come with a
 * reason; the call site wraps them in LlmError / ctx.logger.warn so the
 * user can fix the row.
 */
export function allowBaseUrl(raw, allowlist) {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, reason: "baseURL is empty" };
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: `baseURL is not a parseable URL: ${redactUrl(raw)}` };
  }
  const schemes = allowlist?.schemes ?? DEFAULT_SCHEMES;
  if (!schemes.includes(parsed.protocol)) {
    return { ok: false, reason: `baseURL scheme "${parsed.protocol}" is not in the allowlist (allowed: ${schemes.join(", ")})` };
  }
  const hosts = allowlist?.hosts;
  if (hosts !== undefined && hosts.length > 0) {
    if (!hosts.some((h) => parsed.host === h || parsed.host.endsWith(`.${h}`))) {
      return { ok: false, reason: `baseURL host "${parsed.host}" is not in the allowlist` };
    }
  }
  return { ok: true, parsed };
}

/**
 * Drop path / query / fragment before logging — useful when the path
 * itself carries a token (some proxies embed it as a query param).
 */
export function redactUrl(raw) {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "<unparseable url>";
  }
}
