// Opt-in board sharing. Off by default. Records the board (names and numbers only, never a picture or log text)
// and sends it to YOUR collector (worker/), and/or keeps it in a local file you can download.
(function () {
  'use strict';
  var K = 'vorax-share-v1', Q = 'vorax-share-boards';
  var current = null, editTimer = 0, cfg = { on: null, url: '', key: '' }, log = [], unsent = [], gid = '', seq = 0, lastRound = 99, lastSig = '', busy = false;
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(K) || '{}')); } catch (e) { /* storage unavailable */ }
  // the collector built into this copy (js/share-config.js): friends only tick the switch
  var BUILT = window.VORAX_SHARE || {};
  if (!cfg.url && BUILT.url) cfg.url = BUILT.url;
  if (!cfg.key && BUILT.key) cfg.key = BUILT.key;
  // the built-in collector moved (a new address in share-config.js): a copy saved with the old built-in one follows it
  if (BUILT.url && cfg.url !== BUILT.url && (cfg.url === cfg.builtUrl || (BUILT.key && cfg.key === BUILT.key))) { cfg.url = BUILT.url; cfg.key = BUILT.key || cfg.key; }
  if (BUILT.url) cfg.builtUrl = BUILT.url;
  // on by default in a copy with a built-in collector, until the player turns it off (cfg.on is null until they choose)
  if (cfg.on === null || cfg.on === undefined) cfg.on = !!(BUILT.url && BUILT.key && BUILT.onByDefault);
  function notice() {
    if (!cfg.on || !BUILT.onByDefault) return;
    try { if (localStorage.getItem('vorax-share-notice')) return; } catch (e) { /* show it */ }
    var n = document.createElement('div');
    n.className = 'share-notice';
    n.innerHTML = '<b>Board sharing is on.</b> The boards this helper reads (tank numbers, card and instrument names, round) are sent to the helper\u2019s maker to improve its advice. No pictures, names, accounts or anything about you. <span class="btns"><button class="btn" type="button" data-a="ok">OK</button><button class="btn" type="button" data-a="off">Turn it off</button></span>';
    n.onclick = function (e) { var a = e.target.dataset && e.target.dataset.a; if (!a) return; if (a === 'off') { cfg.on = false; save(); var c = document.getElementById('shareOn'); if (c) c.checked = false; report(); } try { localStorage.setItem('vorax-share-notice', '1'); } catch (x) { /* fine */ } n.remove(); };
    document.body.appendChild(n);
  }
  try { var q = JSON.parse(localStorage.getItem(Q) || '{}'); log = q.log || []; unsent = q.unsent || []; gid = q.gid || ''; seq = q.seq || 0; } catch (e) { /* none yet */ }
  var $ = function (id) { return document.getElementById(id); };
  function save() { try { localStorage.setItem(K, JSON.stringify(cfg)); localStorage.setItem(Q, JSON.stringify({ log: log.slice(-2000), unsent: unsent.slice(-500), gid: gid, seq: seq })); } catch (e) { /* full or blocked */ } }
  var rid = function () { var a = new Uint8Array(8); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; }); return Array.prototype.map.call(a, function (x) { return (x % 36).toString(36); }).join(''); };
  function make(s, src) {
    return {
      v: 1, g: gid, n: 0, t: Date.now(), src: src, round: s.round, phase: s.phase,
      hand: s.hand.slice(0, s.phase === 'potion' ? s.handSize : 3).filter(Boolean), inst: s.instruments.filter(Boolean),
      pr: s.potionRefreshes, ir: s.instrumentRefreshes,
      tanks: s.tanks.map(function (t) { return t ? { a: t.archetype, r: t.rarity, act: Math.round(t.activity), qty: Math.round(t.quantity) } : null; })
    };
  }
  function newGame() { gid = rid(); seq = 0; lastRound = 99; lastSig = ''; }
  function endpoint() { return cfg.url.replace(/\/+$/, ''); }
  function stat(t, bad) { var e = $('shareStat'); if (e) { e.textContent = t; e.className = 'note' + (bad ? ' err' : ''); } }

  function flush() {
    if (busy || !cfg.on || !endpoint() || !cfg.key || !unsent.length) return report();
    busy = true; var batch = unsent.slice(0, 50);
    fetch(endpoint() + '/ingest', { method: 'POST', headers: { 'content-type': 'application/json', 'x-key': cfg.key }, body: JSON.stringify({ boards: batch }) })
      .then(function (r) { if (!r.ok) throw new Error('server said ' + r.status); unsent = unsent.slice(batch.length); save(); })
      .catch(function (e) { busyFail = true; stat('Could not send: ' + e.message + ' (will retry on the next board)', true); })
      .then(function () { busy = false; if (unsent.length && !busyFail) flush(); else report(); });
  }
  var busyFail = false;
  function report() { stat(!cfg.on ? 'Off. Nothing is recorded.' : log.length + ' board' + (log.length === 1 ? '' : 's') + ' kept here' + (endpoint() ? ', ' + unsent.length + ' waiting to send.' : '. No endpoint set, so nothing is uploaded.')); }

  window.VoraxShare = {
    /** s: the page's board state; src: 'live' or 'shot'; trigger: 'screen' when the game screen just opened */
    board: function (s, src, trigger, chk) {
      if (!cfg.on) return;
      if (trigger === 'screen' || !gid || (s.round === 1 && lastRound > 1 && lastRound !== 99)) newGame();
      var rec = make(s, src);
      if (chk && chk.length) rec.chk = chk.slice(0, 40);
      var sig = JSON.stringify([rec.round, rec.phase, rec.hand, rec.inst, rec.pr, rec.ir, rec.tanks]);
      if (sig === lastSig) return; lastSig = sig; lastRound = s.round; rec.n = ++seq; current = rec;
      log.push(rec); unsent.push(rec); save(); busyFail = false; flush(); report();
    },
    /** the player fixed the board by hand after a reading: the same board number is sent again, corrected */
    edited: function (s) {
      if (!cfg.on || !current) return;
      clearTimeout(editTimer);
      editTimer = setTimeout(function () {
        var rec = make(s, current.src); rec.g = current.g; rec.n = current.n; rec.fixed = true;
        var sig = JSON.stringify([rec.round, rec.phase, rec.hand, rec.inst, rec.pr, rec.ir, rec.tanks]);
        if (sig === lastSig) return; lastSig = sig;
        log = log.filter(function (r) { return !(r.g === rec.g && r.n === rec.n); }); log.push(rec);
        unsent = unsent.filter(function (r) { return !(r.g === rec.g && r.n === rec.n); }); unsent.push(rec);
        save(); busyFail = false; flush(); report();
      }, 3000);
    },
    newGame: function () { newGame(); save(); },
    /** A card the reader didn't recognise: its title as read and a small picture of it go to the collector (sent
     *  once per title on this PC), so new cards are known early. Only with sharing on and a collector set. */
    unknownCard: function (phase, text, img, rect) {
      if (!cfg.on || !endpoint() || !cfg.key || !text || !img || !rect) return;
      var norm = String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (norm.replace(/ /g, '').length < 3) return;
      var seen = {}; try { seen = JSON.parse(localStorage.getItem('vorax-cards-sent') || '{}'); } catch (e) { /* none */ }
      if (seen[phase + '|' + norm]) return;
      try {
        var src = document.createElement('canvas'); src.width = img.width; src.height = img.height; src.getContext('2d').putImageData(img, 0, 0);
        var w = Math.min(260, Math.round(rect.w)), h = Math.round(rect.h * w / rect.w);
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(src, Math.max(0, rect.x), Math.max(0, rect.y), rect.w, rect.h, 0, 0, w, h);
        var pic = c.toDataURL('image/jpeg', 0.8).split(',')[1] || '';
        if (pic.length > 100000) pic = c.toDataURL('image/jpeg', 0.55).split(',')[1] || '';
        fetch(endpoint() + '/card', { method: 'POST', headers: { 'content-type': 'application/json', 'x-key': cfg.key }, body: JSON.stringify({ phase: phase, text: String(text).slice(0, 200), picture: pic }) })
          .then(function (r) { if (r.ok) { seen[phase + '|' + norm] = Date.now(); try { localStorage.setItem('vorax-cards-sent', JSON.stringify(seen)); } catch (e) { /* fine */ } } })
          .catch(function () { /* next time */ });
      } catch (e) { /* no picture: skipped */ }
    }
  };

  function init() {
    if (!$('shareOn')) return;
    // the built-in collector's address and key are never shown on the page (the address names its owner)
    var builtIn = function () { return !!BUILT.url && cfg.url === BUILT.url; };
    var showFields = function (own) {
      $('shareFields').hidden = !own; if ($('shareBuilt')) $('shareBuilt').hidden = own;
      $('shareUrl').value = builtIn() ? '' : cfg.url; $('shareKey').value = builtIn() ? '' : cfg.key;
    };
    showFields(!builtIn());
    if ($('shareKicker')) $('shareKicker').textContent = BUILT.url && BUILT.onByDefault ? 'On by default · nothing about you' : 'Optional';
    if ($('shareOwn')) $('shareOwn').onclick = function (e) { e.preventDefault(); showFields(true); $('shareUrl').focus(); };
    // a blank own collector goes back to the built-in one
    var own = function () {
      var u = $('shareUrl').value.trim(), k = $('shareKey').value.trim();
      if (!u && BUILT.url) { cfg.url = BUILT.url; cfg.key = BUILT.key || ''; } else { cfg.url = u; cfg.key = k; }
      save(); report();
    };
    $('shareOn').checked = cfg.on;
    $('shareOn').onchange = function () { cfg.on = this.checked; save(); report(); if (cfg.on) flush(); };
    $('shareUrl').onchange = own;
    $('shareKey').onchange = own;
    $('shareTest').onclick = function () {
      if (!endpoint()) return stat('Enter your collector URL first.', true);
      stat('Testing…');
      fetch(endpoint() + '/', {}).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok) throw new Error('not a collector');
        return fetch(endpoint() + '/check', { headers: { 'x-key': cfg.key } }).then(function (r) { return r.json(); }).then(function (c) {
          stat(!c.send ? 'Reached the collector, but the key is wrong.' : c.export ? 'Connected. This key can send and download boards (keep it to yourself).' : 'Connected. This key can send boards.', !c.send);
        });
      }).catch(function (e) { stat('Could not reach it: ' + e.message, true); });
    };
    $('shareDl').onclick = function () {
      if (!log.length) return stat('Nothing recorded yet.', true);
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([log.map(function (r) { return JSON.stringify(r); }).join('\n') + '\n'], { type: 'application/x-ndjson' })); a.download = 'vorax-boards-local.jsonl'; a.click();
    };
    $('shareClear').onclick = function () { log = []; unsent = []; save(); report(); };
    report(); if (cfg.on) flush(); notice();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
