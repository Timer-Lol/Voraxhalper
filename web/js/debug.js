// The helper's debug recorder. Keeps, on this PC only: every picture the reader got (as JPEG), what it read
// from it with its confidence per field, the board it loaded, the advice given, the player's own fixes, live
// events and errors. "Save debug bundle" puts the lot in one .zip to send; review.html steps through one.
// Inside the desktop app each entry is also written to disk (the last runs are kept there).
(function () {
  'use strict';
  var VERSION = 'helper-0.4';
  var MAX_EVENTS = 1500, MAX_FRAMES = 40;
  var events = [], frames = {}, frameOrder = [], seq = 0, frameSeq = 0, started = Date.now();
  var D = function () { return window.VoraxDesktop; };

  function add(type, data) {
    var e = Object.assign({ n: ++seq, t: Date.now(), type: type }, data || {});
    events.push(e); if (events.length > MAX_EVENTS) events.shift();
    try { var d = D(); if (d && d.record) d.record(e); } catch (x) { /* app not listening */ }
    return e;
  }
  function jpeg(img) {
    return new Promise(function (ok) {
      try {
        var c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        c.getContext('2d').putImageData(img, 0, 0);
        c.toBlob(function (b) { ok(b); }, 'image/jpeg', 0.92);
      } catch (x) { ok(null); }
    });
  }
  var compactFields = function (f) { var o = {}; Object.keys(f || {}).forEach(function (k) { var v = f[k]; o[k] = [v.sure ? 1 : 0, v.guess == null ? null : String(v.guess).slice(0, 40), v.score == null ? null : Math.round(v.score * 1000) / 1000, v.second == null ? null : Math.round(v.second * 1000) / 1000].concat(v.note ? [v.note] : []); }); return o; };
  var board = function (S) { return { round: S.round, phase: S.phase, pr: S.potionRefreshes, ir: S.instrumentRefreshes, handSize: S.handSize, fromBox: S.fromBox, hand: S.hand.slice(0, S.phase === 'potion' ? S.handSize : 3), inst: S.instruments.slice(), tanks: S.tanks.map(function (t) { return t ? [t.archetype, t.rarity, t.activity, t.quantity] : null; }) }; };

  var lastRead = null, fixTimer = 0;
  window.VoraxDebug = {
    VERSION: VERSION,
    event: add,
    /** a picture and what the reader made of it */
    read: function (img, info) {
      var id = ++frameSeq, name = 'frames/' + String(id).padStart(4, '0') + '.jpg';
      var e = add('read', Object.assign({ frame: name, size: [img.width, img.height] }, info, { fields: compactFields(info.fields) }));
      lastRead = { e: e, board: info.board };
      jpeg(img).then(function (b) {
        if (!b) return;
        frames[name] = b; frameOrder.push(name);
        while (frameOrder.length > MAX_FRAMES) delete frames[frameOrder.shift()];
        try { var d = D(); if (d && d.recordFrame) b.arrayBuffer().then(function (ab) { d.recordFrame(name, ab); }); } catch (x) { /* not kept on disk */ }
      });
      return e;
    },
    board: board,
    /** the player changed the board after a reading: what the reader had, and what the player says it is */
    edited: function (S) {
      if (!lastRead) return;
      clearTimeout(fixTimer);
      fixTimer = setTimeout(function () {
        var now = board(S), was = lastRead.board, diff = [];
        ['round', 'phase', 'pr', 'ir'].forEach(function (k) { if (now[k] !== was[k]) diff.push([k, was[k], now[k]]); });
        now.tanks.forEach(function (t, i) { if (JSON.stringify(t) !== JSON.stringify(was.tanks[i])) diff.push(['tank' + i, was.tanks[i], t]); });
        now.hand.forEach(function (h, i) { if ((h || '') !== (was.hand[i] || '')) diff.push(['hand' + i, was.hand[i] || '', h || '']); });
        now.inst.forEach(function (h, i) { if ((h || '') !== (was.inst[i] || '')) diff.push(['instrument' + i, was.inst[i] || '', h || '']); });
        if (diff.length) { add('fix', { of: lastRead.e.n, frame: lastRead.e.frame, diff: diff, board: now }); lastRead.board = now; }
      }, 1500);
    },
    /** download everything as one .zip */
    bundle: function (extra) {
      var manifest = {
        version: VERSION, saved: new Date().toISOString(), started: new Date(started).toISOString(), page: location.pathname.split('/').pop(),
        browser: navigator.userAgent, screen: [screen.width, screen.height], dpr: window.devicePixelRatio, app: !!D(),
        events: events.length, frames: frameOrder.length,
      };
      var files = [{ name: 'manifest.json', data: JSON.stringify(Object.assign(manifest, extra || {}), null, 2) }, { name: 'events.jsonl', data: events.map(function (e) { return JSON.stringify(e); }).join('\n') + '\n' }];
      var appLog = D() && D().appLog ? D().appLog().catch(function () { return ''; }) : Promise.resolve('');
      return Promise.all([appLog].concat(frameOrder.map(function (n) { return frames[n].arrayBuffer().then(function (b) { return { name: n, data: new Uint8Array(b) }; }); }))).then(function (r) {
        if (r[0]) files.push({ name: 'app-log.txt', data: r[0] });
        files = files.concat(r.slice(1));
        var blob = new Blob([VoraxZip.zip(files)], { type: 'application/zip' });
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = 'vorax-debug-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.zip'; a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
        return { events: events.length, frames: frameOrder.length, bytes: blob.size };
      });
    },
    counts: function () { return { events: events.length, frames: frameOrder.length }; },
    clear: function () { events = []; frames = {}; frameOrder = []; lastRead = null; add('cleared'); },
  };
  window.addEventListener('error', function (e) { add('error', { message: String(e.message).slice(0, 300), where: (e.filename || '').split('/').pop() + ':' + e.lineno }); });
  window.addEventListener('unhandledrejection', function (e) { add('error', { message: String(e.reason && e.reason.message || e.reason).slice(0, 300), where: 'promise' }); });
  add('session', { version: VERSION, page: location.pathname.split('/').pop() });
})();
