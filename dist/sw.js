const CACHE_PREFIX = "eiken-word-tactics-";
const VERSION = "v1.3.1";
const CACHE = `${CACHE_PREFIX}${VERSION}`;
const ESSENTIAL = [
  "./", "./index.html", "./styles.css", "./app.js", "./game-engine.js", "./session-engine.js", "./timer-engine.js", "./mission-engine.js",
  "./manifest.webmanifest", "./icons/icon.svg", "./icons/maskable.svg", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png",
  "./data/missions.json", "./data/tactics.json", "./data/runtime/index.json"
];
const LEVEL_FILES = new Set(["eiken-4.json", "eiken-3.json", "eiken-pre-2.json", "eiken-2.json", "eiken-pre-1.json"]);
const OPTIONAL = [
  ...["easy", "medium", "hard", "challenge"].flatMap((level) => ["landscape-large.webp", "landscape-medium.webp", "landscape-mobile.webp", "deck-thumbnail.webp"].map((file) => `./assets/art/${level}/${file}`)),
  ...["eiken-word-deck-emblem", "eiken-plaque", "nathan-seal", "paper-texture"].map((file) => `./assets/decor/${file}.webp`),
  ...["reroll", "extra-time", "word-swap"].map((file) => `./assets/cards/tactics/${file}.webp`),
  ...["sentence", "question", "answer", "example", "opinion", "connection", "story", "combo"].map((file) => `./assets/cards/missions/${file}.webp`),
  "./assets/cards/covers/mission-deck.webp", "./assets/cards/covers/tactic-deck.webp"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ESSENTIAL);
    await Promise.allSettled(OPTIONAL.map(async (url) => {
      const response = await fetch(url);
      if (response.ok) await cache.put(url, response);
    }));
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") self.skipWaiting();
  if (event.data?.type === "CACHE_LEVEL" && LEVEL_FILES.has(event.data.file)) {
    event.waitUntil((async () => {
      try {
        const url = new URL(`./data/runtime/${event.data.file}`, self.location).href;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Deck request failed (${response.status}).`);
        const cache = await caches.open(CACHE);
        await cache.put(url, response);
        event.source?.postMessage({ type: "LEVEL_CACHED", level: event.data.level });
      } catch {
        event.source?.postMessage({ type: "LEVEL_CACHE_FAILED", level: event.data.level });
      }
    })());
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function updateCache(request, response) {
  if (!response?.ok || new URL(request.url).origin !== self.location.origin) return;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        event.waitUntil(updateCache(new Request(new URL("./index.html", self.location).href, { credentials: "same-origin" }), response.clone()));
        return response;
      } catch {
        return (await caches.match("./index.html")) || new Response("Offline copy unavailable", { status: 503, headers: { "Content-Type": "text/plain" } });
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request).then((response) => {
      if (response.ok) event.waitUntil(updateCache(request, response));
      return response;
    });
    if (cached) {
      event.waitUntil(network.catch(() => undefined));
      return cached;
    }
    try { return await network; }
    catch {
      if (request.destination === "image") return new Response(null, { status: 204 });
      return new Response("Offline resource unavailable", { status: 503, headers: { "Content-Type": "text/plain" } });
    }
  })());
});
