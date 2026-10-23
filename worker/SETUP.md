# Board collector setup (Cloudflare Worker, about 10 minutes)

You need a free Cloudflare account and Node.js. Run these in this `worker/` folder:

1. `npx wrangler login`  (opens a browser; approve it)
2. `npx wrangler d1 create vorax-boards`
   Copy the `database_id` it prints into `wrangler.toml`.
3. `npx wrangler d1 execute vorax-boards --remote --file=schema.sql`
4. Make a secret key (any long random text) and store it:
   `npx wrangler secret put KEY`   (paste the key when asked)
5. `npx wrangler deploy`
   It prints your URL, like `https://vorax-collector.YOURNAME.workers.dev`.

In the helper (analyze page, "Share boards"): tick the switch, paste the URL and your key, press **Test connection**.

Getting your data back: open `https://YOUR-URL/export?key=YOUR-KEY` in a browser. It downloads `vorax-boards.jsonl`; upload that file to me.

Notes
- Only board numbers and card names are stored. No pictures, no log lines, no IP address.
- Boards are accepted only with your key. If you share the helper with friends, give them the same key, or make a second worker.
- The free plan is far more than enough. To delete everything: `npx wrangler d1 execute vorax-boards --remote --command="DELETE FROM boards"`.

Updating the collector after a new helper version: copy the new `worker.js` over the old one (keep your `wrangler.toml`, it has your database id) and run `npx wrangler deploy` again. Your stored boards are kept.


## Collecting boards from other players
1. Redeploy after updating `worker.js`: `npx wrangler deploy` (in this folder).
2. Give yourself a private download key: `npx wrangler secret put EXPORT_KEY` (a different long random text).
   From then on `KEY` only *sends* boards, so it's safe to share; only `EXPORT_KEY` downloads them:
   `https://YOUR-URL/export?key=YOUR-EXPORT-KEY`.
3. Put your worker's URL and the sending `KEY` in `web/js/share-config.js`, then share the helper folder.
   Your friends open the analyzer's "Share boards" panel and tick "Record the boards I read". Nothing else to type.

## Debug reports from players (Cloudflare R2)
Players can send you their Ctrl+Alt+J debug bundle from the app (Settings → Game log & debug → Send a report).
They're asked first; nothing is sent otherwise. Each report is a .zip of a few MB (pictures of the game window,
what the helper read and advised, their fixes, the app log). Free R2 storage is 10 GB, roughly 1,000 reports.

One-time setup, in this `worker/` folder:
1. In the Cloudflare dashboard open **R2 Object Storage** and turn it on (Cloudflare may ask for a payment method;
   the free allowance has no charge).
2. `npx wrangler r2 bucket create vorax-reports`
3. `npx wrangler d1 execute vorax-boards --remote --file=schema.sql`   (adds the daily upload counter; your boards are kept)
4. `npx wrangler deploy`

Reading them: open `https://YOUR-URL/reports?key=YOUR-EXPORT-KEY` for a list with Download and Delete links
(your private EXPORT_KEY, never the sending key). `/check?key=...` shows `"reports": true` once it's set up.
Limits: 25 MB a report, 10 a day per sender, 300 a day in all.

## New cards players see
With board sharing on, a card the helper doesn't recognise (a new potion or instrument) is sent once: its title as
read, and a small picture of it. After updating `worker.js`, run once in this folder:
`npx wrangler d1 execute vorax-boards --remote --file=schema.sql` and `npx wrangler deploy`.
See them at `https://YOUR-URL/cards?key=YOUR-EXPORT-KEY` (most seen first). Pictures are kept in the same R2 bucket
as the reports; without R2 only the titles are kept.

## Reports as GitHub issues (optional)
Each report can also open an issue on the helper's GitHub page, so you see problems come in there. The issue has the
player's note, the app version, their screens and settings, and the board at the time; never the pictures, the log
or anything about the player (the full report stays private in R2, at `/reports`). At most 20 issues a day.

1. On GitHub: your picture → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** →
   Generate new token. Repository access: **Only select repositories** → Voraxhalper. Permissions → Repository
   permissions → **Issues: Read and write**. Pick an expiry (it stops working after it), then Generate, and copy it.
2. In this `worker/` folder: `npx wrangler secret put GITHUB_TOKEN` (paste the token when asked).
3. The repository is set in `wrangler.toml` (`GITHUB_REPO`). Run `npx wrangler deploy`.

`/check?key=...` shows `"issues": true` once it's on. Issues get the label "player report" when the token may make it.
To stop: `npx wrangler secret delete GITHUB_TOKEN`.
