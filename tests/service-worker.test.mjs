import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../dist/sw.js", import.meta.url), "utf8");

function loadWorker({ fetchImpl, addAll = async () => {}, match = async () => null } = {}) {
  const listeners = {};
  const puts = [];
  const cache = { addAll, put: async (request, response) => { puts.push({ request, response }); } };
  const context = {
    URL, Request, Response, Promise, Set,
    fetch: fetchImpl || (async () => new Response("ok")),
    caches: { open: async () => cache, match, keys: async () => [], delete: async () => true },
    self: {
      location: new URL("https://example.test/"),
      clients: { claim: async () => {} },
      skipWaiting: () => {},
      addEventListener: (type, callback) => { listeners[type] = callback; }
    }
  };
  vm.runInNewContext(source, context, { filename: "sw.js" });
  return { listeners, puts };
}

test("optional install failures do not discard the verified offline core", async () => {
  const worker = loadWorker({ fetchImpl: async () => { throw new Error("optional missing"); } });
  let pending;
  worker.listeners.install({ waitUntil: (promise) => { pending = promise; } });
  await assert.doesNotReject(pending);
});

test("an essential install failure rejects the interrupted update", async () => {
  const worker = loadWorker({ addAll: async () => { throw new Error("essential missing"); } });
  let pending;
  worker.listeners.install({ waitUntil: (promise) => { pending = promise; } });
  await assert.rejects(pending, /essential missing/);
});

test("offline missing images and data receive type-safe fallbacks", async () => {
  const worker = loadWorker({ fetchImpl: async () => { throw new Error("offline"); } });
  async function responseFor(path, destination) {
    let response;
    worker.listeners.fetch({
      request: { url: `https://example.test/${path}`, method: "GET", mode: "cors", destination },
      respondWith: (promise) => { response = promise; },
      waitUntil: () => {}
    });
    return response;
  }
  assert.equal((await responseFor("missing.png", "image")).status, 204);
  const json = await responseFor("missing.json", "");
  assert.equal((await json).status, 503);
  assert.match(await (await json).text(), /Offline resource unavailable/);
});

test("only an allow-listed selected level can be cached on demand", async () => {
  const messages = [];
  const worker = loadWorker({ fetchImpl: async () => new Response("{}", { status: 200 }) });
  let pending;
  worker.listeners.message({
    data: { type: "CACHE_LEVEL", file: "eiken-3.json", level: "EIKEN 3" },
    source: { postMessage: (message) => messages.push(message) },
    waitUntil: (promise) => { pending = promise; }
  });
  await pending;
  assert.equal(worker.puts.length, 1);
  assert.equal(messages[0].type, "LEVEL_CACHED");
  assert.equal(messages[0].level, "EIKEN 3");

  pending = undefined;
  worker.listeners.message({ data: { type: "CACHE_LEVEL", file: "../../secret.json", level: "bad" }, waitUntil: (promise) => { pending = promise; } });
  assert.equal(pending, undefined);
});
