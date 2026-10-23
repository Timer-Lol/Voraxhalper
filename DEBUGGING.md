# Debugging the helper

Everything the reader does is recorded on your PC, so a misread can be looked at afterwards exactly as it happened.

## What is recorded
For every picture the helper reads (screenshot, live or app): the picture itself (JPEG), the window trim it chose,
every field it read with its match score (and the runner-up's), the raw text of each tank's two lines, the board
it loaded, the advice it gave (instant, look-ahead, deep check), every fix you make by hand afterwards, live-log
events and any page errors. Nothing is uploaded: it stays in the browser tab (the last 40 pictures) or, in the
desktop app, on disk (the last 5 runs, under `%APPDATA%\Vorax Helper\records`).

## Sending a problem
- Analyzer page: **Save debug bundle** (in the "Read my game" panel). Fix the wrong fields first: your fixes are the
  truth the reader is checked against.
- Desktop app: press **Ctrl+Alt+J** the moment something goes wrong: it marks that moment, takes a fresh picture and saves the bundle to Downloads (no dialog). Or Settings → Game log & debug → Save.
Send the `vorax-debug-….zip`.

## Looking at one yourself
Open **review.html** (or tray → Open debug review) and drop the bundle in. Step with ← →. Boxes show where the
reader looked: green read clearly, amber unsure, red fixed by you afterwards. **Re-read** runs the current reader
on the same picture and highlights what changed.

## Replaying bundles (developer)
`bun scripts/replay.ts bundle1.zip bundle2.zip …` re-reads every picture with the current reader and reports what
reads differently and whether your hand fixes are now read correctly ("player fixes now matched 5 of 7").
