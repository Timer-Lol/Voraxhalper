// Vorax Helper board collector: a Cloudflare Worker + D1 table.
//   POST /ingest   one board (JSON) or {boards:[...]}   header X-Key: <KEY>
//   GET  /export   every stored board as JSON lines    header X-Key: <KEY>  (or ?key=)
//   GET  /         health check
// Only the board's numbers and names are stored: no pictures, no log text, no IP address.
//
// Debug reports (optional, needs the R2 bucket bound as REPORTS, see SETUP.md): a player's Ctrl+Alt+J bundle,
// sent only when they press "Send to the developer" and agree.
//   POST /report          the bundle (a .zip, up to 25 MB)        X-Key: <KEY>   X-Note: what went wrong (optional)
//   GET  /reports         a page listing them, with download links   ?key=<EXPORT_KEY>   (?format=json for JSON)
//   GET  /report/<id>     one report's .zip                          ?key=<EXPORT_KEY>   (&delete=1 deletes it)
//   POST /reports/delete  several at once (the reports page's ticked boxes)   form: key=<EXPORT_KEY>, id=..., id=...
// With a GitHub token set (secret GITHUB_TOKEN, and GITHUB_REPO in wrangler.toml, see SETUP.md) each report also opens a
// GitHub issue: the player's note, the app's version and settings, the board at the time, and the report's id. Never the
// pictures, the log or anything about the player; the .zip itself stays private here. At most 20 issues a day.
//
// Cards the helper didn't recognise (a new potion or instrument, say), sent with board sharing: the title as read and a
// small picture of the card, so new cards are known early.
//   POST /card            { phase, text, picture (base64 JPEG, up to 80 KB) }   X-Key: <KEY>
//   GET  /cards           a page of them, most seen first            ?key=<EXPORT_KEY>   (?format=json for JSON)
//   GET  /card/<id>.jpg   one card's picture                          ?key=<EXPORT_KEY>
// Uploads are limited to 10 a day per sender and 300 a day in all; the sender is told apart by a salted hash of
// their address, which is never stored itself.

const ARCH = new Set(['pest', 'aemberon', 'boneSentry', 'agito']);
const RAR = new Set(['normal', 'magic', 'rare', 'boss']);
const PHASE = new Set(['potion', 'instrument', 'protocol']);
const MAX_BODY = 32 * 1024, MAX_BATCH = 50;

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...cors() } });
const cors = () => ({ 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,x-key,x-note,x-app', 'access-control-allow-methods': 'GET,POST,OPTIONS' });
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const name = v => typeof v === 'string' && v.length > 0 && v.length <= 60 && /^[\w .,'&()\/-]+$/.test(v);

/** Returns a cleaned copy of a board, or null when it isn't a plausible one. */
export function clean(b) {
  if (!b || typeof b !== 'object') return null;
  if (typeof b.g !== 'string' || !/^[a-z0-9]{6,24}$/.test(b.g)) return null;
  if (!int(b.n, 0, 100000) || !int(b.round, 1, 13) || !PHASE.has(b.phase)) return null;
  if (!Array.isArray(b.tanks) || b.tanks.length !== 6) return null;
  const tanks = [];
  for (const t of b.tanks) {
    if (t === null) { tanks.push(null); continue; }
    if (!t || !ARCH.has(t.a) || !RAR.has(t.r) || !int(t.act, 0, 1e7) || !int(t.qty, 0, 1e7)) return null;
    tanks.push({ a: t.a, r: t.r, act: t.act, qty: t.qty });
  }
  if (!Array.isArray(b.hand) || b.hand.length > 5 || !b.hand.every(name)) return null;
  if (!Array.isArray(b.inst) || b.inst.length > 3 || !b.inst.every(name)) return null;
  const pr = b.pr == null ? null : b.pr, ir = b.ir == null ? null : b.ir;
  if ((pr !== null && !int(pr, 0, 9)) || (ir !== null && !int(ir, 0, 9))) return null;
  const src = b.src === 'live' || b.src === 'shot' ? b.src : 'shot';
  const t = int(b.t, 1.6e12, 4e12) ? b.t : Date.now();
  const chk = Array.isArray(b.chk) ? b.chk.filter(k => typeof k === 'string' && /^[\w.]{1,30}$/.test(k)).slice(0, 40) : [];
  return { v: 1, g: b.g, n: b.n, t, src, round: b.round, phase: b.phase, hand: b.hand, inst: b.inst, pr, ir, tanks, ...(chk.length ? { chk } : {}), ...(b.fixed === true ? { fixed: true } : {}) };
}

// KEY lets a helper send boards (you can share it with friends); EXPORT_KEY (yours alone) downloads them.
// Without an EXPORT_KEY set, KEY does both, as before.
const keyOf = (req) => req.headers.get('x-key') || new URL(req.url).searchParams.get('key') || '';
const same = (a, b) => !!b && a.length === b.length && a === b;
const canSend = (req, env) => same(keyOf(req), env.KEY) || same(keyOf(req), env.EXPORT_KEY);
const canExport = (req, env) => same(keyOf(req), env.EXPORT_KEY || env.KEY);

const MAX_REPORT = 25 * 1024 * 1024, PER_SENDER = 10, PER_DAY = 300;
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Times on the pages are shown in Pacific time (PST/PDT follows daylight saving on its own).
const PACIFIC = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' });
const pacific = (t) => {
  const d = new Date(t);
  if (isNaN(d)) return '';
  const p = Object.fromEntries(PACIFIC.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${p.timeZoneName || ''}`.trim();
};
const cleanNote = (t) => { try { t = decodeURIComponent(t || ''); } catch { t = ''; } return t.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300); };
async function hashOf(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** Counts one upload for this sender and for the day; false when either is over its limit. */
async function allowed(env, who, day) {
  const bump = (w) => env.DB.prepare('INSERT INTO report_limits (day, who, n) VALUES (?, ?, 1) ON CONFLICT (day, who) DO UPDATE SET n = n + 1 RETURNING n').bind(day, w).first('n');
  const [mine, all] = [await bump(who), await bump('*')];
  return mine <= PER_SENDER && all <= PER_DAY;
}
async function report(req, env) {
  if (!canSend(req, env)) return json({ error: 'bad key' }, 401);
  if (!env.REPORTS) return json({ error: 'reports are not set up on this collector' }, 503);
  if (Number(req.headers.get('content-length') || 0) > MAX_REPORT) return json({ error: 'too large' }, 413);
  const body = await req.arrayBuffer();
  if (body.byteLength > MAX_REPORT) return json({ error: 'too large' }, 413);
  const head = new Uint8Array(body, 0, Math.min(4, body.byteLength));
  if (head.length < 4 || head[0] !== 0x50 || head[1] !== 0x4b || head[2] !== 3 || head[3] !== 4) return json({ error: 'not a zip' }, 415);
  const day = new Date().toISOString().slice(0, 10);
  const who = await hashOf((req.headers.get('cf-connecting-ip') || '') + '|' + (env.KEY || ''));
  if (!(await allowed(env, who, day))) return json({ error: 'too many reports today' }, 429);
  const id = `${day}/${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const note = cleanNote(req.headers.get('x-note'));
  const appVersion = cleanNote(req.headers.get('x-app')).slice(0, 40);
  await env.REPORTS.put(`reports/${id}.zip`, body, { httpMetadata: { contentType: 'application/zip' }, customMetadata: { note, app: appVersion, size: String(body.byteLength) } });
  let issue = null;
  try { issue = await openIssue(env, { id, note, appVersion, body, day }); } catch (e) { issue = null; }
  return json({ ok: true, id, ...(issue ? { issue } : {}) });
}

// ---------- a GitHub issue for each report (optional) ----------
const ISSUES_PER_DAY = 20;
/** The files of a .zip written by the helper (stored, not compressed), by name: { name: Uint8Array }. */
function unzipStored(buf, want) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf), out = {}, dec = new TextDecoder();
  for (let at = 0; at + 30 <= u8.length && dv.getUint32(at, true) === 0x04034b50;) {
    const method = dv.getUint16(at + 8, true), size = dv.getUint32(at + 18, true), n = dv.getUint16(at + 26, true), extra = dv.getUint16(at + 28, true);
    const name = dec.decode(u8.subarray(at + 30, at + 30 + n)), start = at + 30 + n + extra;
    if (method === 0 && want.includes(name)) out[name] = u8.subarray(start, start + size);
    at = start + size;
  }
  return out;
}
/** The board a report was about: the moment the player flagged, or else the last board read. */
function boardOf(events) {
  let read = null, flag = null;
  for (const line of events.split('\n')) {
    if (!line || !line.includes('"board"')) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'flag' && e.board) flag = e.board;
    else if (e.type === 'read' && e.board) read = e.board;
  }
  return flag ? { ...flag, flagged: true } : read;
}
// text from players goes into a public issue: no mentions, no links that ping or embed
const plain = (t, max) => String(t || '').replace(/@/g, '@\u200b').replace(/!\[/g, '[').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').slice(0, max);
const cell = (t) => plain(t, 80).replace(/\|/g, '/').replace(/\n/g, ' ');
async function openIssue(env, { id, note, appVersion, body, day }) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return null;
  const n = await env.DB.prepare('INSERT INTO report_limits (day, who, n) VALUES (?, ?, 1) ON CONFLICT (day, who) DO UPDATE SET n = n + 1 RETURNING n').bind(day, 'github-issues').first('n');
  if (n > ISSUES_PER_DAY) return null;
  const files = unzipStored(body, ['manifest.json', 'events.jsonl']);
  const dec = new TextDecoder();
  let m = {}; try { m = JSON.parse(dec.decode(files['manifest.json'] || new Uint8Array())); } catch { m = {}; }
  const events = files['events.jsonl'] ? dec.decode(files['events.jsonl']) : '';
  const pictures = (events.match(/"type":\s*"read"/g) || []).length;
  const b = boardOf(events);
  const lines = [];
  // the note as plain text (a code block: no links, pictures or mentions from a stranger's text)
  lines.push(note ? '```text\n' + plain(note, 300).replace(/`/g, "'") + '\n```' : '_No note given._', '');
  lines.push('| | |', '|---|---|');
  lines.push(`| App | ${cell(m.version || appVersion || '?')} |`);
  if (m.os) lines.push(`| Windows | ${cell(m.os)} |`);
  if (Array.isArray(m.displays)) lines.push(`| Screens | ${cell(m.displays.map((d) => `${d.size?.[0]}x${d.size?.[1]}${d.scale && d.scale !== 1 ? ' @' + d.scale : ''}`).join(', '))} |`);
  else if (m.screen) lines.push(`| Screen | ${cell(m.screen.join('x'))}${m.dpr && m.dpr !== 1 ? ' @' + m.dpr : ''} |`);
  if (!m.app && m.browser) lines.push(`| Browser | ${cell(m.browser)} |`);
  lines.push(`| Pictures read | ${pictures} |`);
  if (m.settings) lines.push(`| Settings | ${plain(Object.entries(m.settings).map(([k, v]) => `${k}: ${v}`).join(', '), 600).replace(/\|/g, '/')} |`);
  if (b) {
    const tank = (t) => (t ? `${t[1]} ${t[0]} ${t[2]}×${t[3]}` : 'empty');
    lines.push('', `**Board${b.flagged ? ' when the player flagged it' : ' last read'}:** round ${cell(b.round)}, ${cell(b.phase)} pick`);
    if (b.hand?.length) lines.push(`- Hand: ${b.hand.map(cell).join(' · ')}`);
    if (b.inst?.length) lines.push(`- Instruments: ${b.inst.filter(Boolean).map(cell).join(' · ')}`);
    if (b.tanks) lines.push(`- Tanks: ${b.tanks.map(tank).map(cell).join(' · ')}`);
  }
  lines.push('', `Report \`${id}\`: the full report with its pictures is kept privately by the developer.`);
  const title = `Player report: ${note ? plain(note, 70).replace(/\s+/g, ' ') + (note.length > 70 ? '…' : '') : 'no note (' + day + ')'}`;
  const post = (labels) => fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'vorax-helper-collector', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' },
    body: JSON.stringify({ title, body: lines.join('\n'), ...(labels ? { labels } : {}) }),
  });
  let r = await post(['player report']);
  if (r.status === 422 || r.status === 403) r = await post(null); // a token that can't make the label still opens the issue
  if (!r.ok) return null;
  const j = await r.json();
  return { number: j.number, url: j.html_url };
}
async function reportList(req, env, url) {
  if (!canExport(req, env)) return json({ error: 'bad key' }, 401);
  if (!env.REPORTS) return json({ error: 'reports are not set up on this collector' }, 503);
  const items = [];
  let cursor;
  do {
    const page = await env.REPORTS.list({ prefix: 'reports/', cursor, include: ['customMetadata'] });
    for (const o of page.objects) items.push({ id: o.key.slice(8, -4), size: o.size, uploaded: o.uploaded.toISOString(), note: (o.customMetadata && o.customMetadata.note) || '', app: (o.customMetadata && o.customMetadata.app) || '' });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && items.length < 5000);
  items.sort((a, b) => (a.uploaded < b.uploaded ? 1 : -1));
  if (url.searchParams.get('format') === 'json') return json(items);
  const k = encodeURIComponent(keyOf(req));
  const rows = items.map((r) => `<tr><td><input type="checkbox" name="id" value="${esc(r.id)}" data-t="${esc(r.uploaded)}"></td><td>${esc(pacific(r.uploaded))}</td><td>${(r.size / 1048576).toFixed(1)} MB</td><td>${esc(r.app)}</td><td>${esc(r.note) || '<i>no note</i>'}</td><td><a href="/report/${esc(r.id)}?key=${k}">Download</a> · <a href="/report/${esc(r.id)}?key=${k}&delete=1" onclick="return confirm('Delete this report?')">Delete</a></td></tr>`).join('');
  const done = url.searchParams.get('deleted');
  // (Vorax Helper) ticking reports to download or delete together: "Delete selected" posts them to /reports/delete
  const bar = `<div class="bar"><label><input type="checkbox" id="all"> All</label><button type="button" id="old">Select older than 7 days</button><button type="button" id="dl">Download selected</button><button type="submit" id="del" class="danger">Delete selected</button><span id="n">0 selected</span></div>`;
  const script = `<script>(function(){var f=document.getElementById('f'),box=function(){return Array.prototype.slice.call(f.querySelectorAll('input[name=id]'))},sel=function(){return box().filter(function(b){return b.checked})},count=function(){document.getElementById('n').textContent=sel().length+' selected'};f.addEventListener('change',count);document.getElementById('all').onchange=function(){var on=this.checked;box().forEach(function(b){b.checked=on});count()};document.getElementById('old').onclick=function(){var t=Date.now()-7*864e5;box().forEach(function(b){b.checked=Date.parse(b.dataset.t)<t});count()};document.getElementById('dl').onclick=function(){sel().forEach(function(b,i){setTimeout(function(){var a=document.createElement('a');a.href='/report/'+b.value+'?key=${k}';a.download='';document.body.appendChild(a);a.click();a.remove()},i*700)})};f.onsubmit=function(){var n=sel().length;if(!n){alert('Tick the reports to delete first.');return false}return confirm('Delete '+n+' report'+(n>1?'s':'')+'? This can\\'t be undone.')}})()</script>`;
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vorax Helper reports</title><style>body{font:14px system-ui,sans-serif;margin:24px;background:#0c1119;color:#c5cddb}table{border-collapse:collapse;width:100%}td,th{padding:6px 10px;border-bottom:1px solid #26344d;text-align:left;vertical-align:top}a{color:#54c7b0}h1{font-size:20px;color:#e9ddc2}.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 12px}button{font:inherit;background:#1a2433;color:#c5cddb;border:1px solid #33445f;border-radius:6px;padding:5px 10px;cursor:pointer}button.danger{border-color:#8a3a3a;color:#ffb4a8}.ok{color:#7fd4a8;margin:0 0 10px}</style><h1>Debug reports (${items.length})</h1>${done ? `<p class="ok">Deleted ${esc(done)} report${done === '1' ? '' : 's'}.</p>` : ''}<form id="f" method="post" action="/reports/delete"><input type="hidden" name="key" value="${esc(keyOf(req))}">${bar}<table><tr><th></th><th>Sent (Pacific)</th><th>Size</th><th>App</th><th>Note</th><th></th></tr>${rows}</table></form>${script}`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
/** (Vorax Helper) Several reports deleted at once, from the reports page's ticked boxes (a form: key, id, id, ...). */
async function reportDeleteMany(req, env, url) {
  const form = await req.formData().catch(() => null);
  const key = (form && form.get('key')) || keyOf(req);
  if (!same(String(key), env.EXPORT_KEY || env.KEY)) return json({ error: 'bad key' }, 401);
  if (!env.REPORTS) return json({ error: 'reports are not set up on this collector' }, 503);
  const ids = [...new Set((form ? form.getAll('id') : []).map(String))].filter((id) => /^\d{4}-\d\d-\d\d\/[a-z0-9]+-[0-9a-f]{8}$/.test(id)).slice(0, 1000);
  if (ids.length) await env.REPORTS.delete(ids.map((id) => `reports/${id}.zip`));
  return Response.redirect(`${url.origin}/reports?key=${encodeURIComponent(String(key))}&deleted=${ids.length}`, 303);
}
async function reportGet(req, env, id, url) {
  if (!canExport(req, env)) return json({ error: 'bad key' }, 401);
  if (!env.REPORTS) return json({ error: 'reports are not set up on this collector' }, 503);
  if (!/^\d{4}-\d\d-\d\d\/[a-z0-9]+-[0-9a-f]{8}$/.test(id)) return json({ error: 'not found' }, 404);
  if (url.searchParams.get('delete') === '1') {
    await env.REPORTS.delete(`reports/${id}.zip`);
    return Response.redirect(`${url.origin}/reports?key=${encodeURIComponent(keyOf(req))}`, 303);
  }
  const o = await env.REPORTS.get(`reports/${id}.zip`);
  if (!o) return json({ error: 'not found' }, 404);
  return new Response(o.body, { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="vorax-report-${id.replace('/', '-')}.zip"` } });
}

const MAX_CARD_PICTURE = 80 * 1024, CARDS_PER_SENDER = 60;
const normText = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
async function card(req, env) {
  if (!canSend(req, env)) return json({ error: 'bad key' }, 401);
  const raw = await req.text();
  if (raw.length > MAX_CARD_PICTURE * 1.4 + 2000) return json({ error: 'too large' }, 413);
  let b; try { b = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400); }
  const phase = PHASE.has(b.phase) ? b.phase : null;
  const text = String(b.text || '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 200);
  if (!phase || normText(text).replace(/ /g, '').length < 3) return json({ error: 'no card' }, 422);
  let pic = null;
  if (typeof b.picture === 'string' && b.picture.length) {
    try { pic = Uint8Array.from(atob(b.picture), (c) => c.charCodeAt(0)); } catch { return json({ error: 'bad picture' }, 400); }
    if (pic.length > MAX_CARD_PICTURE || pic[0] !== 0xff || pic[1] !== 0xd8) return json({ error: 'bad picture' }, 415);
  }
  const day = new Date().toISOString().slice(0, 10);
  const who = 'card:' + (await hashOf((req.headers.get('cf-connecting-ip') || '') + '|' + (env.KEY || '')));
  const n = await env.DB.prepare('INSERT INTO report_limits (day, who, n) VALUES (?, ?, 1) ON CONFLICT (day, who) DO UPDATE SET n = n + 1 RETURNING n').bind(day, who).first('n');
  if (n > CARDS_PER_SENDER) return json({ error: 'too many today' }, 429);
  const id = await hashOf(phase + '|' + normText(text));
  const now = Date.now();
  const had = await env.DB.prepare('SELECT picture FROM new_cards WHERE id = ?').bind(id).first('picture');
  const keep = pic && env.REPORTS && !had ? `cards/${id}.jpg` : had || null;
  if (pic && env.REPORTS && !had) await env.REPORTS.put(keep, pic, { httpMetadata: { contentType: 'image/jpeg' } });
  await env.DB.prepare('INSERT INTO new_cards (id, phase, text, seen, first, last, picture) VALUES (?, ?, ?, 1, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET seen = seen + 1, last = excluded.last, picture = COALESCE(new_cards.picture, excluded.picture)').bind(id, phase, text, now, now, keep).run();
  return json({ ok: true, id });
}
async function cardList(req, env, url) {
  if (!canExport(req, env)) return json({ error: 'bad key' }, 401);
  const rows = (await env.DB.prepare('SELECT id, phase, text, seen, first, last, picture FROM new_cards ORDER BY seen DESC, last DESC LIMIT 2000').all()).results;
  if (url.searchParams.get('format') === 'json') return json(rows);
  const k = encodeURIComponent(keyOf(req));
  const cards = rows.map((r) => `<div class="c">${r.picture ? `<img src="/card/${esc(r.id)}.jpg?key=${k}" alt="">` : '<div class="none">no picture</div>'}<b>${esc(r.text)}</b><span>${esc(r.phase)} · seen ${r.seen}× · last ${esc(pacific(r.last))}</span></div>`).join('');
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vorax Helper: unrecognised cards</title><style>body{font:14px system-ui,sans-serif;margin:24px;background:#0c1119;color:#c5cddb}h1{font-size:20px;color:#e9ddc2}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}.c{background:#121b2a;border:1px solid #26344d;border-radius:8px;padding:10px;display:grid;gap:6px}.c img{width:100%;border-radius:4px}.c span{color:#8190a8;font-size:12px}.none{color:#8190a8;font-size:12px}</style><h1>Cards the helper didn't recognise (${rows.length})</h1><p>The text is the card's title as the helper read it, so it may be garbled; the picture shows the real card.</p><div class="g">${cards}</div>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
async function cardPicture(req, env, id) {
  if (!canExport(req, env)) return json({ error: 'bad key' }, 401);
  if (!env.REPORTS || !/^[0-9a-f]{16}$/.test(id)) return json({ error: 'not found' }, 404);
  const o = await env.REPORTS.get(`cards/${id}.jpg`);
  return o ? new Response(o.body, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3600' } }) : json({ error: 'not found' }, 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    if (url.pathname === '/') return json({ ok: true, service: 'vorax-helper-collector' });
    if (url.pathname === '/ingest' && req.method === 'POST') {
      if (!canSend(req, env)) return json({ error: 'bad key' }, 401);
      const text = await req.text();
      if (text.length > MAX_BODY) return json({ error: 'too large' }, 413);
      let body; try { body = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
      const list = Array.isArray(body.boards) ? body.boards.slice(0, MAX_BATCH) : [body];
      const good = list.map(clean).filter(Boolean);
      if (!good.length) return json({ error: 'no valid boards' }, 422);
      const now = Date.now();
      await env.DB.batch(good.map(b => env.DB.prepare('INSERT INTO boards (g, n, received, data) VALUES (?, ?, ?, ?) ON CONFLICT (g, n) DO UPDATE SET received = excluded.received, data = excluded.data').bind(b.g, b.n, now, JSON.stringify(b))));
      return json({ stored: good.length, rejected: list.length - good.length });
    }

    if (url.pathname === '/export' && req.method === 'GET') {
      if (!canExport(req, env)) return json({ error: 'bad key' }, 401);
      const rows = await env.DB.prepare('SELECT data FROM boards ORDER BY id').all();
      return new Response(rows.results.map(r => r.data).join('\n') + '\n', { headers: { 'content-type': 'application/x-ndjson', 'content-disposition': 'attachment; filename="vorax-boards.jsonl"', ...cors() } });
    }
    if (url.pathname === '/check' && req.method === 'GET') return json({ send: canSend(req, env), export: canExport(req, env), reports: !!env.REPORTS, issues: !!(env.GITHUB_TOKEN && env.GITHUB_REPO) });
    if (url.pathname === '/report' && req.method === 'POST') return report(req, env);
    if (url.pathname === '/card' && req.method === 'POST') return card(req, env);
    if (url.pathname === '/cards' && req.method === 'GET') return cardList(req, env, url);
    if (url.pathname.startsWith('/card/') && url.pathname.endsWith('.jpg') && req.method === 'GET') return cardPicture(req, env, url.pathname.slice(6, -4));
    if (url.pathname === '/reports' && req.method === 'GET') return reportList(req, env, url);
    if (url.pathname === '/reports/delete' && req.method === 'POST') return reportDeleteMany(req, env, url);
    if (url.pathname.startsWith('/report/') && req.method === 'GET') return reportGet(req, env, decodeURIComponent(url.pathname.slice(8)), url);
    return json({ error: 'not found' }, 404);
  },
};
