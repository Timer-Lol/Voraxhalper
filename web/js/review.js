// Debug review: steps through a debug bundle's events, drawing where the reader looked on each picture.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  var B = null, at = 0, img = null, reread = null, scanner = null;
  var COL = { ok: '#54c7b0', no: '#e6b34a', fix: '#e0685f', none: '#8190a8' };

  function open(file) {
    $('openMsg').textContent = 'Opening…';
    file.arrayBuffer().then(VoraxZip.unzip).then(function (f) {
      var dec = new TextDecoder();
      if (!f['events.jsonl']) throw new Error('This .zip has no events.jsonl: is it a Vorax Helper debug bundle?');
      var events = dec.decode(f['events.jsonl']).split('\n').filter(Boolean).map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
      var manifest = f['manifest.json'] ? JSON.parse(dec.decode(f['manifest.json'])) : {};
      // fixes, by the reading they correct
      var fixes = {}; events.forEach(function (e) { if (e.type === 'fix') (fixes[e.of] = fixes[e.of] || []).push(e); });
      B = { manifest: manifest, events: events, files: f, fixes: fixes };
      $('openMsg').textContent = file.name + ': ' + events.length + ' events, ' + Object.keys(f).filter(function (n) { return /^frames\//.test(n); }).length + ' pictures, saved ' + (manifest.saved || '?') + (manifest.app ? ' from the app' : ' from the browser') + '.';
      $('view').hidden = false;
      timeline();
      var first = events.findIndex(function (e) { return e.type === 'read'; });
      go(first < 0 ? 0 : first);
    }).catch(function (e) { $('openMsg').innerHTML = '<span class="err">' + esc(e.message) + '</span>'; });
  }
  function kind(e) {
    if (e.type === 'read') return e.kept ? 'read' : (e.unsure && e.unsure.length) ? 'unsure' : 'read';
    if (e.type === 'fix') return 'fix';
    if (e.type === 'error' || e.type === 'live-error' || e.type === 'flag') return 'err';
    return '';
  }
  function timeline() {
    $('timeline').innerHTML = B.events.map(function (e, i) { return '<button data-i="' + i + '" class="' + kind(e) + '" title="#' + e.n + ' ' + e.type + '"></button>'; }).join('');
  }
  $('timeline').onclick = function (e) { var b = e.target.closest('button'); if (b) go(+b.dataset.i); };

  function frameFor(i) { for (var k = i; k >= 0; k--) if (B.events[k].type === 'read' && B.events[k].frame) return B.events[k]; return null; }
  function go(i) {
    at = Math.max(0, Math.min(B.events.length - 1, i)); reread = null;
    Array.prototype.forEach.call($('timeline').children, function (b, k) { b.classList.toggle('on', k === at); });
    var e = B.events[at], r = frameFor(at);
    $('where').textContent = 'Event ' + (at + 1) + ' of ' + B.events.length + ' · ' + e.type + ' · ' + new Date(e.t).toLocaleTimeString();
    $('ev').textContent = JSON.stringify(e, null, 1).slice(0, 6000);
    var data = r && B.files[r.frame];
    if (!data) { img = null; draw(); fieldsTable(r); return; }
    createImageBitmap(new Blob([data], { type: 'image/jpeg' })).then(function (bmp) { img = bmp; draw(); fieldsTable(r); });
  }
  $('prev').onclick = function () { go(at - 1); };
  $('next').onclick = function () { go(at + 1); };
  document.addEventListener('keydown', function (e) { if (!B || /INPUT|SELECT/.test(document.activeElement.tagName)) return; if (e.key === 'ArrowLeft') go(at - 1); if (e.key === 'ArrowRight') go(at + 1); });
  $('boxes').onchange = function () { draw(); };

  function fixedKeys(r) {
    var keys = {}; (B.fixes[r && r.n] || []).forEach(function (f) { f.diff.forEach(function (d) { keys[d[0]] = d; }); });
    return keys;
  }
  function status(fields, key, fixed) {
    var tank = /^tank(\d)\./.exec(key), fk = tank ? 'tank' + tank[1] : key;
    if (fixed[fk]) return 'fix';
    var f = fields && fields[key];
    if (!f) return 'none';
    return f[0] ? 'ok' : 'no';
  }
  function draw() {
    var cv = $('cv'), ctx = cv.getContext('2d');
    if (!img) { cv.width = 960; cv.height = 120; ctx.fillStyle = '#101826'; ctx.fillRect(0, 0, 960, 120); ctx.fillStyle = '#8190a8'; ctx.font = '16px Inter, sans-serif'; ctx.fillText('No picture for this event.', 20, 64); return; }
    cv.width = img.width; cv.height = img.height; ctx.drawImage(img, 0, 0);
    var r = frameFor(at); if (!r || !$('boxes').checked) return;
    var c = r.crop || {}, ox = c.left || 0, oy = c.top || 0, w = img.width - ox - (c.right || 0), h = img.height - oy - (c.bottom || 0);
    if (c.top || c.bottom || c.left || c.right) { ctx.strokeStyle = '#a98bfb'; ctx.setLineDash([10, 6]); ctx.lineWidth = 3; ctx.strokeRect(ox, oy, w, h); ctx.setLineDash([]); }
    var uiR = (reread && reread.ui) || r.ui || 1, sh = (reread && reread.shift) || r.handShift || [0, 0], L;
    if (Vorax.handLayout) L = Vorax.handLayout({ width: w, height: h }, uiR, sh);
    else {
      L = Vorax.layout({ width: w, height: h }, uiR);
      if (sh[0] || sh[1]) { var kk = L.k; L.header = Object.assign({}, L.header, { x: L.header.x + sh[0] * kk, y: L.header.y + sh[1] * kk }); L.cardFace = L.cardFace.map(function (q) { return Object.assign({}, q, { y: q.y + sh[1] * kk }); }); }
    }
    var fields = (reread && reread.fields) || r.fields, fixed = fixedKeys(r);
    var box = function (rect, key, label) {
      if (!rect) return;
      var st = status(fields, key, fixed);
      ctx.strokeStyle = COL[st]; ctx.lineWidth = Math.max(2, img.height / 600); ctx.strokeRect(ox + rect.x, oy + rect.y, rect.w, rect.h);
      if (label) { ctx.font = Math.round(img.height / 70) + 'px JetBrains Mono, monospace'; ctx.fillStyle = COL[st]; ctx.fillText(label, ox + rect.x + 2, oy + rect.y - 4); }
    };
    for (var i = 0; i < 6; i++) {
      box(L.nameBand[i], 'tank' + i + '.rarity', 'T' + (i + 1));
      box(L.totalBand[i], 'tank' + i + '.activity');
      box(L.aqBand[i], 'tank' + i + '.quantity');
      box(L.icon[i], 'tank' + i + '.archetype');
    }
    box(L.round, 'round', 'round'); box(L.refresh, 'refreshes', 'refreshes'); box(L.header, 'phase', 'phase');
    (L.cardFace || []).forEach(function (rc, j) { box(rc, 'hand' + j, 'card ' + (j + 1)); });
    (L.instrumentIcon || []).forEach(function (rc, j) { box(rc, 'instrument' + j, 'inst ' + (j + 1)); });
  }
  function fieldsTable(r) {
    if (!r) { $('summary').textContent = 'No reading before this event.'; $('fields').innerHTML = ''; $('meta').textContent = ''; return; }
    $('meta').textContent = (r.src || '') + (r.trigger ? ' · ' + r.trigger : '') + (r.ms ? ' · ' + r.ms + ' ms' : '');
    var fixed = fixedKeys(r), fx = Object.keys(fixed).map(function (k) { var d = fixed[k]; return k + ': ' + JSON.stringify(d[1]) + ' → ' + JSON.stringify(d[2]); });
    $('summary').innerHTML = (r.kept ? '<div class="err">Not used: ' + esc(r.kept) + '</div>' : '') +
      (r.crop && (r.crop.top || r.crop.bottom || r.crop.left || r.crop.right) ? '<div>Trimmed: ' + esc(JSON.stringify(r.crop)) + '</div>' : '') +
      (r.problems && r.problems.length ? '<div>Problems: ' + esc(r.problems.join(', ')) + '</div>' : '') +
      (r.tanksRaw ? '<div>Tank lines as read: ' + esc(r.tanksRaw.map(function (t, i) { return t ? 'T' + (i + 1) + ' ' + t.total + ' / ' + t.aq : 'T' + (i + 1) + ' —'; }).join(' · ')) + '</div>' : '') +
      (fx.length ? '<div style="color:var(--bad)">Fixed by hand: ' + esc(fx.join(' · ')) + '</div>' : '') +
      (reread ? '<div style="color:var(--accent)">Re-read with the current reader in ' + reread.ms + ' ms: changed rows are highlighted.</div>' : '');
    var keys = Object.keys(r.fields || {}).concat(reread ? Object.keys(reread.fields).filter(function (k) { return !(k in r.fields); }) : []).sort();
    $('fields').innerHTML = '<tr><td>field</td><td>read</td><td>score</td>' + (reread ? '<td>now</td>' : '') + '</tr>' + keys.map(function (k) {
      var f = (r.fields || {})[k] || [0, null, null, null], n = reread && reread.fields[k], chg = n && (n[0] !== f[0] || String(n[1]) !== String(f[1]));
      return '<tr class="' + (f[0] ? '' : 'no') + (chg ? ' chg' : '') + '"><td>' + esc(k) + '</td><td>' + esc(f[1] == null ? '' : f[1]) + (f[0] ? '' : ' ?') + '</td><td>' + (f[2] == null ? '' : f[2] + (f[3] != null ? ' / ' + f[3] : '')) + '</td>' + (reread ? '<td>' + (n ? esc(n[1] == null ? '' : n[1]) + (n[0] ? '' : ' ?') : '') + '</td>' : '') + '</tr>';
    }).join('');
  }
  $('reread').onclick = function () {
    var r = frameFor(at); if (!r || !img) return;
    var btn = this; btn.disabled = true; btn.textContent = 'Reading…';
    var c = document.createElement('canvas'); c.width = img.width; c.height = img.height; var x = c.getContext('2d'); x.drawImage(img, 0, 0);
    var t0 = Date.now(); scanner = scanner || Vorax.createScanner();
    scanner(x.getImageData(0, 0, img.width, img.height)).then(function (res) {
      var o = {}; Object.keys(res.fields).forEach(function (k) { var v = res.fields[k]; o[k] = [v.sure ? 1 : 0, v.guess == null ? null : String(v.guess), v.score == null ? null : Math.round(v.score * 1000) / 1000, v.second == null ? null : Math.round(v.second * 1000) / 1000]; });
      reread = { fields: o, ms: Date.now() - t0, crop: res.crop, shift: res.handShift, ui: res.ui };
      draw(); fieldsTable(r);
    }).catch(function (e) { alert('Re-read failed: ' + e.message); }).then(function () { btn.disabled = false; btn.textContent = 'Re-read with current reader'; });
  };

  var drop = $('drop');
  drop.onclick = function () { $('file').click(); };
  $('file').onchange = function () { if (this.files[0]) open(this.files[0]); this.value = ''; };
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer.files[0]) open(e.dataTransfer.files[0]); });
})();
