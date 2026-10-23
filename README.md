# Vorax Helper

A helper for **Torchlight: Infinite's Vorax / Surgical Preparation** minigame. It reads your board from the game
window, tells you the best move, and shows it in a small card over the game, with the card, tanks and Confirm
boxed on screen.

It only reads and advises. **It never clicks or types in the game:** you play every move yourself.

## Download and run (Windows)

1. Go to **[Releases](../../releases/latest)** and download `Vorax-Helper-Setup.exe`.
2. Run it. It installs for your Windows user only and starts by itself. Windows SmartScreen may say "Windows
   protected your PC" because the installer isn't signed: click **More info → Run anyway**.
3. In the game, turn the log on once: **Esc → Account Related → Enable Log**, then log out and back in.
4. Play **windowed or borderless**: nothing can draw over exclusive fullscreen.
5. Open Surgical Preparation. The helper finds the game window and its log by itself, and the card over the game
   updates after every move.

Don't run the game or the helper as administrator: Windows then refuses the helper's picture of the game window.

### Hotkeys
| Keys | What it does |
|---|---|
| Ctrl+Alt+V | show or hide the card over the game |
| Ctrl+Alt+H | open the helper |
| Ctrl+Alt+X | read the board now |
| Ctrl+Alt+J | something went wrong: save a debug bundle to Downloads |

The tray icon (by the clock) has the settings: the advice to show, your target score, game speed, the highlight,
and from which round you play on your own (round 11, the protocols, by default).

## What the advice is
Every option is played out to the end of the run in simulation, from your exact board, and ranked by the score it
leads to and by the chance of reaching your target (925k by default). The strategy guide in the helper
(`web/strategy.html`) explains the instrument builds and refreshes, with the simulation evidence behind them.

## Privacy
- Pictures of the game window and the game log stay on your PC.
- **Board sharing is on by default**: the boards the helper reads (tank numbers, card and instrument names, the
  round) are sent to the helper's maker to improve its advice. No pictures, names, accounts or anything about you.
  You're told the first time, and can turn it off in the helper (Share boards).
- Debug reports (Ctrl+Alt+J) are sent only if you press Send when asked.

## Without installing
Open `web/index.html` in Chrome or Edge: the board analyzer works in the browser too (enter the board, drop a
screenshot, or follow a live game by sharing the game window and the log file).

## Building it yourself
- Web bundles: `bun scripts/build-web.mjs` (writes `web/js/vorax-engine.js` and `web/js/vorax-workers.js`).
- Desktop app: in `desktop/`, `npm install`, then `npm start` to run it or `npm run dist` for the installer
  (`desktop/dist/Vorax-Helper-Setup.exe`). Or double-click `Start-Vorax-Helper.bat` (needs Node.js).
- `worker/`: the Cloudflare Worker that collects shared boards (see `worker/SETUP.md`).
- `DEBUGGING.md`: how the reader records what it saw, and how to replay a debug bundle.

## Credits
- **Moebing**, [Torchlight-Infinite-SS11-Vorax-simulator](https://github.com/Moebing/Torchlight-Infinite-SS11-Vorax-simulator): the original Vorax simulator, used to gather the
  data the advice is built on (MIT, see LICENSE).
- **Arcasti**, [tli-warden](https://github.com/arcasti/tli-warden): her solver logic.
- **Sif**, [tli-tools](https://github.com/WolfDan/tli-tools): help with the in-game textures.

Vibe coded by Timer.
