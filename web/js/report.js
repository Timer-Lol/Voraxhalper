// (Vorax Helper) "Report a problem": one button on the board analyzer sends what the helper recorded to its maker
// (the collector built into this copy, js/share-config.js), with the player's note. Inside the desktop app it sends
// the app's own record of the latest run (pictures, readings, advice, fixes, the app's log and settings); in a browser,
// this page's. Nothing is sent until the player presses Send.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var C = window.VORAX_SHARE, dlg = $('repDlg');
  if (!dlg || !$('repBtn')) return;
  var app = window.VoraxDesktop && window.VoraxDesktop.settings && window.VoraxDesktop.settings.sendReport ? window.VoraxDesktop.settings : null;
  var canSend = !!(C && C.url && C.key);
  var issues = null; // whether the collector opens a GitHub issue for each report (asked once)

  function what() {
    var parts = app
      ? 'the latest run the app recorded: its pictures of the game window, what it read and advised, the fixes you made, the app’s log and its settings'
      : 'what this page recorded: the pictures of the game it read, what it read and advised, and the fixes you made (' + (window.VoraxDebug ? VoraxDebug.counts().frames + ' pictures' : 'nothing yet') + ')';
    return 'Sends ' + parts + ', with your note, to the helper’s maker. Nothing else from your PC; no game-log text' + (app ? ', and user and machine names and addresses in the text files are blanked. “Look at the files first” shows every file exactly as it would go.' : '.') +
      (issues ? ' A public issue is also opened on the helper’s GitHub page with your note and the board at the time (never the pictures).' : '');
  }
  function status(t, cls) { var s = $('repStatus'); s.className = 'note' + (cls ? ' ' + cls : ''); s.innerHTML = t; }
  function open() {
    $('repWhat').textContent = what();
    status(canSend ? '' : 'This copy has no report address: use “Save to a file” and send the .zip instead.', canSend ? '' : 'err');
    $('repSend').disabled = !canSend;
    $('repSend').textContent = 'Send report';
    if (!dlg.open) dlg.showModal();
    setTimeout(function () { $('repNote').focus(); }, 30);
    if (canSend && issues === null) {
      fetch(C.url.replace(/\/+$/, '') + '/check', { headers: { 'x-key': C.key } }).then(function (r) { return r.json(); })
        .then(function (j) { issues = !!(j && j.issues); $('repWhat').textContent = what(); }).catch(function () { issues = false; });
    }
  }
  function done(ok, msg, issue) {
    var link = issue && /^https:\/\/github\.com\//.test(issue) ? ' <a href="' + issue + '" target="_blank" rel="noopener">See it on GitHub</a>.' : '';
    status(msg.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }) + link, ok ? 'ok' : 'err');
    $('repSend').disabled = false;
    $('repSend').textContent = ok ? 'Send another' : 'Try again';
    if (ok) $('repNote').value = '';
  }
  function send() {
    var note = $('repNote').value.trim().slice(0, 300);
    $('repSend').disabled = true; $('repSend').textContent = 'Sending…';
    status('Sending… (a few MB: this can take a little while)');
    var viaPage = function () {
      return VoraxDebug.report(note, { target: (document.getElementById('target') || {}).value }).then(function (r) {
        if (r.ok) done(true, 'Report sent. Thank you!' + (r.issue && r.issue.number ? ' (issue #' + r.issue.number + ')' : ''), r.issue && r.issue.url);
        else done(false, 'Not sent: ' + r.error);
      });
    };
    if (app) {
      app.sendReport(note, true).then(function (v) {
        var s = (v && v.reportStatus) || '';
        if (/^Report sent/.test(s)) return done(true, s, v.reportIssue);
        if (/Nothing recorded yet/.test(s)) return viaPage(); // the app hasn't followed a game yet: this page's record
        done(false, s || 'Not sent.');
      }).catch(function (e) { done(false, 'Not sent: ' + (e && e.message ? e.message : e)); });
    } else viaPage().catch(function (e) { done(false, 'Not sent: ' + (e && e.message ? e.message : e)); });
  }

  $('repBtn').onclick = open;
  if (app && app.previewReport) { $('repLook').hidden = false; $('repLook').onclick = function () { app.previewReport($('repNote').value.trim().slice(0, 300)); status('Opened a window with every file the report would hold; its Send button sends them.', 'ok'); }; }
  $('repSend').onclick = send;
  $('repFile').onclick = function () { $('dbgSave') ? $('dbgSave').click() : VoraxDebug.bundle({}); status('Saved to your Downloads folder as vorax-debug-….zip.', 'ok'); };
  $('repClose').onclick = function () { dlg.close(); };
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  window.VoraxReport = { open: open };
})();
