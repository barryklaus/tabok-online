# TABOK — Experimental WebGPU Edition

Version: **v0.22.0 Multiplayer Alpha — Living Ruins**  
Build: **2026.08.31.M1**

## Multiplayer alpha

- One player hosts a browser room and shares its short room code.
- Up to six players can join from different desktop or mobile platforms, claim a P1–P6 slot, select an unclaimed character, and replace the character name with a custom name.
- Before the expedition begins, every occupied slot rolls a six-sided initiative die. Highest acts first and lowest acts last. Any tied Travelers reroll until the order is unique.
- The host is authoritative: remote devices send their legal clicks and challenge typing to the host, then receive the synchronized board, controls, Portal scenes, and results.
- The global room chat is fixed at the lower-left beneath the compact, independently scrollable guide.
- Refreshing a guest browser reserves and reclaims its slot using a local device token while the host remains online.

The build uses PeerJS/WebRTC for browser-to-browser room traffic. Host it over HTTPS (GitHub Pages is suitable) and keep the host tab open for the entire expedition. No account is required. This is a casual-play alpha rather than an anti-cheat competitive server.

Grand Plunder now plays as a readable sequential barrage: each chosen treasure completes its full flight, lands on the collector, and updates the inventory before the next treasure launches.

Open `index.html` through a secure web host such as GitHub Pages, or serve this
folder locally. The game remains browser-only and requires no installation.

## Renderer

- The game requests WebGPU first for its cached high-resolution board, haunting
  Portal, GPU particles, and Living Ruins atmosphere.
- If WebGPU is unavailable or initialization fails, the same build retries with
  WebGL automatically. SVG remains the final compatibility renderer.
- Firefox direct `file://` launches use the full SVG compatibility board because
  Firefox can expose a GPU canvas while refusing the cached board texture. All
  hexes and gameplay remain available. Hosted builds continue to use WebGPU or
  WebGL automatically.
- The active renderer is displayed in the game header. Add `?debug` to the URL
  to show the live frame-rate meter.
- All W7 gameplay, WebGL optimizations, route effects, reactive hexes, cinematic
  camera emphasis, resonance, spectral events, and replay highlights remain.

## Procedural sound

The W8 soundscape is generated live through the Web Audio API. No MP3 or WAV
files are downloaded.

- Low ruin drone and filtered wind ambience
- Dice casting and raffle-roll impact
- Traveler footsteps and Monster movement
- Separate Take, Give, Steal, Resolve, Rune, Shield, and damage cues
- Portal judgment, rejection, crossing, death, and Major Monster signatures
- Answer-or-Die and Last Breath warning tone
- A persistent **Sound on/off** control in the header

Browsers require a click or key press before audio may begin. The first player
interaction unlocks the sound engine automatically. The mute preference is
remembered on that device.

## Performance controls

- **Fast + Auto** is recommended for online and mobile play.
- **Cinematic + Full** favors richer effects on stronger desktop hardware.
- Procedural audio uses a small number of native audio nodes and does not add
  network weight to the game.
