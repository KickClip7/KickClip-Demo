import test from "node:test";
import assert from "node:assert/strict";
import { kickclipApi } from "../src/api/kickclipApi.js";

test("R3 diagnostics refresh는 canonical endpoint와 refresh=true를 사용한다", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  globalThis.window = {
    localStorage: { getItem: () => null, removeItem: () => {}, setItem: () => {} },
    dispatchEvent: () => {},
  };
  globalThis.fetch = async (url) => {
    requestUrl = String(url);
    return new Response(JSON.stringify({
      enabled: true,
      available: true,
      code: "SCENE_TARGET_TRACKING_AVAILABLE",
      message: "ready",
      components: {},
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await kickclipApi.getTrackingDiagnostics({ refresh: true });
    assert.equal(response.available, true);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
  assert.match(requestUrl, /\/api\/v1\/tracking\/diagnostics\/scene-target-r3\?refresh=true$/);
});
