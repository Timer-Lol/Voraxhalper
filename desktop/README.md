# Vorax Helper: the Windows app

The helper as a desktop app: it finds the game and its log by itself, reads the board after every move, and shows
the advice in a small card over the game, with the move boxed on screen. Same pages and advice as `../web`.
It never clicks or types in the game.

## Run from source
You need Node.js (https://nodejs.org, the LTS version). In this folder:

```
npm install
npm start
```

`npm start` copies the helper pages from `../web` into the app, then opens it. `npm run dist` makes the installer
(`dist/Vorax-Helper-Setup.exe`).

## Using it
1. In the game turn the log on once: Esc → Account Related → Enable Log, then log out and back in.
2. Play windowed or borderless (nothing can draw over exclusive fullscreen).
3. Start the app, then the game. The card appears over the game and updates after every move. Drag it by its
   top bar.

Hotkeys: **Ctrl+Alt+V** show/hide the card · **Ctrl+Alt+H** open the helper · **Ctrl+Alt+X** read the board now ·
**Ctrl+Alt+J** something went wrong: save a debug bundle to Downloads.

## Highlight
On by default: numbered boxes over the game show the move: the card, the tanks to target, then Confirm (or
Refresh). Boxes marked "working it out…" are the instant answer while the look-ahead is still running. Clicks pass
straight through the boxes, and the reader never sees them. From round 11 (Settings → Overlay & highlight) the
highlight is hidden and you play the protocols yourself.

## What it can see
Only the game window and the game's log; pictures and the log stay on your PC. Read boards are shared unless you
turn Share boards off (see the main README).

`--log=<path>` and `--game-title=<regex>` override the log and the window title. Debug log:
`%APPDATA%\Vorax Helper\logs\helper.log`.

## When the pictures don't reach the game
- **The game runs as administrator** (or a launcher started it as one): Windows refuses the window capture. The
  app then takes its own pictures of the game window, or reads the screen with the card hidden.
- **A picture after every move**: the app watches the game screen and reads the board again whenever it changes
  and settles. The game log's lines make it quicker: Esc → Account Related → Enable Log.
