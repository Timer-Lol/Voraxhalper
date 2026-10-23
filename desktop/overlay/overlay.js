// The card over the game: shows the helper's advice, reports its own height so the window fits it.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var api = window.VoraxCard;
  var fit = function () { api.height(document.getElementById('card').getBoundingClientRect().height + 12); };
  var line = function (cls, a, b) { var d = document.createElement('div'); d.className = cls; var s = document.createElement('span'); s.textContent = a; d.appendChild(s); if (b) { var r = document.createElement('b'); r.textContent = b; d.appendChild(r); } return d; };
  api.on('card', function (c) {
    $('move').textContent = c.move || '—';
    $('detail').textContent = c.detail || '';
    var t = c.target ? c.target.replace(/,000,000$/, 'M').replace(/,000$/, 'k') : ''; cardMeta = (c.round ? 'Round ' + c.round : '') + (t ? ' · ' + t : ''); if (!statusUntil || Date.now() > statusUntil) $('meta').textContent = cardMeta;
    $('card').classList.toggle('updating', !!c.updating);
    var o = $('others'); o.textContent = '';
    (c.others || []).forEach(function (x) { var i = x.lastIndexOf(': '); o.appendChild(i > 0 ? line('other', x.slice(0, i), x.slice(i + 2)) : line('other', x)); });
    var a = $('asks'); a.textContent = '';
    (c.asks || []).forEach(function (x) { a.appendChild(line('ask', x)); });
    fit();
  });
  api.on('clicker', function (t) { $('clk').textContent = t || ''; fit(); });
  // Ctrl+Alt+J: the report is saved; the player is asked here, on the card (a dialog would open behind the game)
  api.on('reportAsk', function (r) {
    if (!r) { $('rep').hidden = true; fit(); return; }
    $('repText').textContent = 'Send it to the developer? ' + (r.mb ? '(' + r.mb + ' MB) ' : '') + 'It holds this run\u2019s pictures of the game window, what the helper read and advised, and its log. Nothing else from your PC.';
    $('rep').hidden = false; $('card').classList.remove('folded'); fit();
  });
  $('repSend').onclick = function () { $('rep').hidden = true; api.report(true); fit(); };
  $('repNo').onclick = function () { $('rep').hidden = true; api.report(false); fit(); };
  // a status line (Game found, Reading…) shows for a few seconds, then the round and target come back
  var cardMeta = '', statusUntil = 0, statusTimer = 0;
  api.on('status', function (t) { if (t) { $('meta').textContent = t; statusUntil = Date.now() + 4000; clearTimeout(statusTimer); statusTimer = setTimeout(function () { statusUntil = 0; if (cardMeta) $('meta').textContent = cardMeta; }, 4000); fit(); } });
  api.on('folded', function (f) { $('card').classList.toggle('folded', !!f); fit(); });
  $('fold').onclick = function () { var f = !$('card').classList.contains('folded'); $('card').classList.toggle('folded', f); api.fold(f); fit(); };
  $('open').onclick = function () { api.openHelper(); };
  $('snap').onclick = function () { api.snap(); };
  // drag by the top bar (not its buttons)
  // (the bar is a drag region in overlay.html: Windows moves the card itself, as Tartarus Overlay's)
  new ResizeObserver(fit).observe($('card'));
  fit();
})();
