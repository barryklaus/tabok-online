# TABOK — Experimental WebGPU Edition

Version: **v0.22.7 Multiplayer Alpha — Eclipse Well**  
Build: **2026.09.01.M8**

## Multiplayer alpha

- One player hosts a browser room and shares its short room code.
- The host can mix connected Humans and host-controlled CPU Travelers in any 1–6 player room. Open slots can be assigned individually or filled with CPU companions in one click.
- Human and CPU names and characters remain editable in the lobby. At least one connected Human is required to begin.
- The pre-game roll-off uses a shrinking pool of starting positions from `1` through the active Traveler count. Every Human or CPU roll locks one unused position permanently, removes it from later results, and makes ties impossible. Highest position acts first and lowest acts last.
- Every normal in-game Traveler turn now opens a character-focused dice scene. Human Travelers click to cast Movement, Action, and an owned Rune Die; CPU Travelers visibly prepare and automatically cast the same animated dice. The scene and raffle results synchronize to every connected device.
- The turn-roll scene exists only during the active Traveler's roll phase. Once the dice land, their final results remain on screen for approximately three seconds before movement begins.
- Turn dice now brake dramatically before the final reveal: rapid raffle cycling eases into increasingly slow beats, then lands on “Fate has decided.” The three-second result hold remains intact.
- The central Portal is now the lightweight vector **Eclipse Well**. Its colors and motion shift globally through Idle, Judgment, Crossing, Rejection, and Reckoning, with the authoritative host synchronizing the current state to every connected device.
- The host is authoritative: remote devices send their legal clicks and challenge typing to the host, then receive the synchronized board, controls, Portal scenes, and results.
- The global room chat is fixed at the lower-left beneath the compact, independently scrollable guide.
- Refreshing a guest browser reserves and reclaims its slot using a local device token while the host remains online.
- PeerJS now receives Cloudflare STUN and optional TURN/TLS relay routes. The lobby reports whether TURN is ready, and a 15-second connection diagnostic explains failures instead of loading forever.
- `turn-relay/` contains the deployable Cloudflare Worker that safely issues 24-hour TURN credentials. Configure its public endpoint in `network-config.js`; never place the permanent TURN key in the game files.

The build uses PeerJS/WebRTC for browser-to-browser room traffic. Host it over HTTPS (GitHub Pages is suitable) and keep the host tab open for the entire expedition. Deploy the included TURN credential Worker for reliable play across mobile carriers, restrictive routers, VPNs, and different networks. See `turn-relay/README.md`. No player account is required. This is a casual-play alpha rather than an anti-cheat competitive server.

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
