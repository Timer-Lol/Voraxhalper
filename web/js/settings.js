// The Settings panel. Advice settings live on this page; the overlay card, the highlight,
// the game log and debugging belong to the desktop app and appear when the page runs inside it.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  var D = window.VoraxDesktop && window.VoraxDesktop.settings ? window.VoraxDesktop.settings : null;
  var view = null, tab = 'advice';
  var TABS = [['advice', 'Advice']].concat(D ? [['overlay', 'Overlay & highlight'], ['keys', 'Hotkeys'], ['app', 'Game log & debug']] : [['app', 'Desktop app']]);

  // page controls this panel mirrors
  var ctl = function (id, v) { var e = $(id); if (!e) return; if (e.type === 'checkbox') e.checked = !!v; else e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
  var row = function (title, help, control) { return '<div class="srow"><div class="t">' + title + '</div><div>' + control + '</div>' + (help ? '<div class="h">' + help + '</div>' : '') + '</div>'; };
  var sw = function (key, on, attr) { return '<input type="checkbox" class="swt" data-k="' + key + '"' + (on ? ' checked' : '') + (attr || '') + '>'; };
  var yn = function (b) { return b === true ? 'yes' : b === false ? 'no' : 'unknown'; };
  var sel = function (key, value, options) { return '<select data-k="' + key + '">' + options.map(function (o) { return '<option value="' + o[0] + '"' + (String(o[0]) === String(value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'; };
  var btn = function (what, label, cls) { return '<button type="button" class="btn ' + (cls || '') + '" data-do="' + what + '">' + label + '</button>'; };

  function render() {
    $('setTabs').innerHTML = TABS.map(function (t) { return '<button type="button" role="tab" data-t="' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + t[1] + '</button>'; }).join('');
    var v = view && view.values, h = '';
    if (tab === 'advice') {
      h = (D && v ? row('Game speed', 'For quicker advice. Measured on 1,619 deals (2026-10-22): Thorough reached 925k in 65.4% of runs. Fast picks instruments at once by the value of the board they leave and skips the automatic deep check: 63.6% (a difference within chance), half the thinking time. Fastest also halves the look-ahead for potions: 58.2% (clearly lower), a quarter of the thinking time.', sel('speed', v.speed || 'thorough', [['thorough', 'Thorough (best score)'], ['fast', 'Fast (almost no cost)'], ['fastest', 'Fastest (costs some score)']])) : '') +
        row('Target score', 'What counts as a good run. The deep check and its bars use it.', sel('p:target', $('target').value, Array.prototype.map.call($('target').options, function (o) { return [o.value, o.textContent]; }))) +
        row('Deep check depth', 'More playouts separate close options better, and take longer.', sel('p:depth', $('depth').value, [[30, 'Fast (30 playouts)'], [60, 'Standard (60)'], [150, 'Thorough (150)']])) +
        row('Instrument advice', 'Sweep tables: instant, from our simulation sweeps. Played out from your board: each offer played to the end of the run from your exact tanks (a few seconds). Both are always shown; this picks the one the helper recommends and the highlight shows.', sel('p:instMode', window.VoraxPage ? VoraxPage.instMode() : 'table', [['board', 'Played out from your board (recommended)'], ['table', 'Sweep tables (instant)']])) +
        row('Run the deep check by itself after each read', 'In Live mode and the app, a Fast deep check starts once the board is read.', sw('p:autoDeep', $('autoDeep').checked));
    } else if (!D) {
      h = '<p class="note">The overlay card, the highlight over the game, hotkeys and the game log are part of the <b>desktop app</b> (Vorax-Helper-Setup.exe). Open this page inside it and their settings appear here.</p>';
    } else if (!v) {
      h = '<p class="note">Loading…</p>';
    } else if (tab === 'overlay') {
      h = row('Show the card over the game', 'The advice card, while the game runs. ' + view.hotkeys.overlay.replace('Control', 'Ctrl') + ' toggles it.', sw('overlayOn', v.overlayOn)) +
        row('Only while the game is in front', 'Hide the card and the highlight when you switch to another window.', sw('hideBehind', v.hideBehind, view.koffi ? '' : ' disabled')) +
        row('Highlight the move over the game', 'Numbered boxes on the card, the tanks and Confirm. Clicks pass through; the reader never sees them.', sw('highlight', v.highlight)) +
        row('Advice to show', 'The look-ahead is the strongest for finishing high; the deep check aims at your target score but takes longest.', sel('adviceSource', v.adviceSource, [['instant', 'Instant answer (quickest)'], ['ahead', 'Whole-run look-ahead (recommended)'], ['deep', 'Deep check, aimed at your target']])) +
        row('Hand over to you from round', 'From this round on the highlight is hidden, so you play the end of the run yourself. Round 10 is the last potion pick; 11\u201313 are protocols only.', sel('hideFromRound', v.hideFromRound == null ? 11 : v.hideFromRound, [[11, 'Round 11 (protocols)'], [10, 'Round 10 (last potion pick)'], [0, 'Never']])) +
        row('Show in screenshots and recordings', (view.screenFallback ? 'Paused for now: Windows refused the window capture, so the helper reads the whole screen and must not see the card or the boxes. ' : '') + 'The card and the highlight appear in Snipping Tool, Game Bar and OBS captures, so you can debug them. The helper\u2019s own reader still never sees them.', sw('showInCaptures', v.showInCaptures !== false));
    } else if (tab === 'keys') {
      var names = { overlay: 'Show or hide the card', helper: 'Open the helper', snap: 'Read the board now', report: 'Something went wrong: save a debug bundle to Downloads' };
      h = '<div class="keys">' + Object.keys(names).map(function (k) { return '<kbd>' + esc(view.hotkeys[k].replace('Control', 'Ctrl')) + '</kbd><span>' + names[k] + '</span>'; }).join('') + '</div><p class="note" style="margin-top:14px">Chosen not to clash with other Torchlight overlays, so they can run side by side.</p>';
    } else if (tab === 'app') {
      h = row('Game', view.game ? 'Following: ' + esc(view.game) : 'Not running yet.', '') +
        row('Game log', esc(view.log || 'not found yet') + (view.logChosen ? ' (chosen by you)' : ' (found automatically)'), '<div class="btns">' + btn('pickLog', 'Choose…') + (view.logChosen ? btn('resetLog', 'Find automatically') : '') + '</div>') +
        row('Watch the screen for moves', 'Reads the board again whenever the game screen changes and settles, so a picture is taken after every move even when the game’s log can’t say when (its Enable Log off).', sw('watchScreen', v.watchScreen !== false)) +
        (view.canReport ? row('Send a report to the developer', 'Sends the latest run (its pictures of the game window, what was read and advised, your fixes, the app log) so the problem can be fixed. You’re asked before anything is sent.' + (view.reportStatus ? ' <b>' + esc(view.reportStatus) + '</b>' : ''),
          '<div class="btns" style="flex-direction:column;align-items:stretch;gap:6px"><input type="text" id="reportNote" maxlength="300" placeholder="What went wrong? (optional)" style="min-width:220px"><button type="button" class="btn primary" id="reportSend">Send…</button></div>') : '') +
        row('Debug bundle', 'The latest run on disk (pictures, readings, advice, your fixes) as one .zip to send.', btn('bundle', 'Save…', 'primary')) +
        row('Review a run', 'Step through recorded pictures with the reader’s regions drawn on.', '<div class="btns">' + btn('review', 'Open review') + btn('records', 'Records folder') + btn('appLog', 'App log') + '</div>') +
        '<p class="note" style="margin-top:12px">Vorax Helper ' + esc(view.version) + '. Credits: the original Vorax simulator by Moebing (<a href="https://github.com/Moebing/Torchlight-Infinite-SS11-Vorax-simulator">Torchlight-Infinite-SS11-Vorax-simulator</a>), used to gather the data; solver logic from Arcasti\u2019s <a href="https://github.com/arcasti/tli-warden">tli-warden</a>; help with the in-game textures from Sif (<a href="https://github.com/WolfDan/tli-tools">tli-tools</a>).</p>';
    }
    $('setBody').innerHTML = h;
    var rs = document.getElementById('reportSend');
    if (rs) rs.onclick = function () { rs.disabled = true; rs.textContent = 'Sending…'; D.sendReport(document.getElementById('reportNote').value).then(function (v) { if (v) view = v; render(); }); };
  }
  function refresh() { if (!D) return render(); D.get().then(function (v) { view = v; render(); }); }

  $('setTabs').onclick = function (e) { var b = e.target.closest('button'); if (b) { tab = b.dataset.t; render(); } };
  $('setBody').addEventListener('change', function (e) {
    var el = e.target, k = el.dataset.k; if (!k) return;
    var val = el.type === 'checkbox' ? el.checked : el.value;
    if (k === 'p:instMode') { if (window.VoraxPage) VoraxPage.instMode(val); return; }
    if (k.indexOf('p:') === 0) { ctl(k.slice(2), val); return; }
    if (/^(hideFromRound)$/.test(k)) val = Number(val);
    D.set(k, val).then(function (v) { view = v; render(); });
  });
  $('setBody').addEventListener('click', function (e) {
    var b = e.target.closest('[data-do]'); if (!b || !D) return;
    b.disabled = true;
    D.do(b.dataset.do).then(function (v) { if (v) view = v; render(); });
  });
  var dlg = $('setDlg');
  function open(t) { if (t) tab = t; refresh(); if (!dlg.open) dlg.showModal(); }
  $('setBtn').onclick = function () { open(); };
  $('setClose').onclick = function () { dlg.close(); };
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  if (D && D.onOpen) D.onOpen(function (t) { open(t); });
  window.VoraxSettings = { open: open };
})();
