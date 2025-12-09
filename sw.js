const CACHE_NAME = 'buckshot-final-mp3-v1';

const URLS_TO_CACHE = [
  '/',
  'index.html',
  'style.css',
  'game.js',
  'manifest.json',
  
  // Иконки
  'icon-192.png',
  'icon-512.png',
  'player-icon.png',
  'dealer-icon.png',

  // Музыка (MP3)
  'mus_lobby.mp3',
  'mus_norm1.mp3',
  'mus_norm2.mp3',
  'mus_fin1.mp3',
  'mus_fin2.mp3',
  'mus_win.mp3',
  'mus_death.mp3',

  // Звуки (SFX)
  'snd_shot.mp3',
  'snd_pump.mp3',
  'snd_click.mp3',
  'snd_beer.mp3',
  'snd_cig.mp3',
  'snd_cuff.mp3',
  'snd_saw.mp3',
  'snd_dev.mp3',
  'snd_heal.mp3',
  'snd_heart.mp3',
  'snd_mag.mp3'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(URLS_TO_CACHE))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});