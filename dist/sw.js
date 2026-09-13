const CACHE = "eiken-word-tactics-v1.1.0-physical-deck-2";
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./game-engine.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/maskable.svg",
  "./data/vocabulary.json",
  "./data/missions.json",
  "./data/tactics.json",
  "./assets/art/easy/landscape-large.webp",
  "./assets/art/easy/landscape-medium.webp",
  "./assets/art/easy/landscape-mobile.webp",
  "./assets/art/easy/deck-thumbnail.webp",
  "./assets/art/medium/landscape-large.webp",
  "./assets/art/medium/landscape-medium.webp",
  "./assets/art/medium/landscape-mobile.webp",
  "./assets/art/medium/deck-thumbnail.webp",
  "./assets/art/hard/landscape-large.webp",
  "./assets/art/hard/landscape-medium.webp",
  "./assets/art/hard/landscape-mobile.webp",
  "./assets/art/hard/deck-thumbnail.webp",
  "./assets/art/challenge/landscape-large.webp",
  "./assets/art/challenge/landscape-medium.webp",
  "./assets/art/challenge/landscape-mobile.webp",
  "./assets/art/challenge/deck-thumbnail.webp",
  "./assets/decor/eiken-word-deck-emblem.webp",
  "./assets/decor/eiken-plaque.webp",
  "./assets/decor/nathan-seal.webp",
  "./assets/decor/paper-texture.webp",
  "./assets/cards/tactics/teacher-hint.webp",
  "./assets/cards/tactics/definition-help.webp",
  "./assets/cards/tactics/japanese-help.webp",
  "./assets/cards/tactics/example-help.webp",
  "./assets/cards/tactics/reroll.webp",
  "./assets/cards/tactics/extra-time.webp",
  "./assets/cards/tactics/second-chance.webp",
  "./assets/cards/tactics/word-swap.webp",
  "./assets/cards/missions/sentence.webp",
  "./assets/cards/missions/question.webp",
  "./assets/cards/missions/answer.webp",
  "./assets/cards/missions/example.webp",
  "./assets/cards/missions/opinion.webp",
  "./assets/cards/missions/connection.webp",
  "./assets/cards/missions/story.webp",
  "./assets/cards/missions/combo.webp",
  "./assets/cards/covers/mission-deck.webp",
  "./assets/cards/covers/tactic-deck.webp"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then((cached) => {
    const network = fetch(event.request).then((response) => {
      if (response.ok && new URL(event.request.url).origin === self.location.origin) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    });
    return cached || network.catch(() => caches.match("./index.html"));
  }));
});
