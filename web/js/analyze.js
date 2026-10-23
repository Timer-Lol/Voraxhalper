(function () {
  'use strict';
  var V = window.Vorax, CAT = V.catalog();
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  var ARCH = [['pest', 'Pest', 'P'], ['aemberon', 'Aemberon', 'A'], ['boneSentry', 'Bone Sentry', 'B'], ['agito', 'Agito', 'G']];
  var RAR = ['normal', 'magic', 'rare', 'boss'];
  var BASE = { normal: [1, 36], magic: [5, 24], rare: [15, 12], boss: [300, 1] };
  var TARGETS = [[600000, '600,000'], [700000, '700,000'], [925000, '925,000 (protocols after round 10 → rainbow)'], [1120000, '1,120,000 (rainbow)'], [0, 'Custom…']];
  var KEY = 'vorax-helper-v1';
  var fmt = function (n) { return Math.round(n).toLocaleString('en-US'); };
  var short = function (n) { return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n)); };

  function fresh() { return { target: 925000, custom: 925000, phase: 'potion', round: 1, potionRefreshes: 3, instrumentRefreshes: 2, handSize: 3, fromBox: false, tanks: [null, null, null, null, null, null], instruments: ['', '', ''], hand: ['', '', '', '', ''], depth: 60, sel: -1, instMode: 'board', instModeV: 2 }; }
  var S = load() || fresh();
  // instruments now default to upstream's board method (it matched or beat the sweep tables in head-to-head runs)
  if (S.instModeV !== 2) { S.instMode = 'board'; S.instModeV = 2; }
  // 925,000 is the default target: the least that the instruments of rounds 11-13 (the high-risk protocols) can take to
  // rainbow (1,120,000). It replaces 850,000, which was too low; a target the player picked themselves is kept.
  if (S.targetV !== 3) { if (S.targetV !== 2 || S.target === 850000) S.target = 925000; S.targetV = 3; }
  function load() { try { var j = localStorage.getItem(KEY); return j ? Object.assign(fresh(), JSON.parse(j)) : null; } catch (e) { return null; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable: fine */ } }
  var target = function () { return S.target || S.custom || 600000; };

  /* ---------- setup controls ---------- */
  $('target').innerHTML = TARGETS.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('');
  $('round').innerHTML = Array.from({ length: 13 }, function (_, i) { return '<option value="' + (i + 1) + '">' + (i + 1) + (i + 1 > 10 ? ' (instruments only)' : '') + '</option>'; }).join('');

  function syncControls() {
    var known = TARGETS.some(function (t) { return t[0] === S.target; });
    $('target').value = known ? String(S.target) : '0';
    $('customWrap').hidden = $('target').value !== '0';
    $('customTarget').value = S.custom;
    $('round').value = S.round; $('potionRefreshes').value = S.potionRefreshes; $('instrumentRefreshes').value = S.instrumentRefreshes; $('depth').value = S.depth;
    Array.prototype.forEach.call($('phase').children, function (b) { b.classList.toggle('on', b.dataset.v === S.phase); });
    $('tgtLabel').textContent = fmt(target());
  }
  $('target').onchange = function () { var v = +this.value; S.target = v; if (v === 0) S.custom = +$('customTarget').value || 600000; changed(true); };
  $('customTarget').onchange = function () { S.custom = Math.max(1000, +this.value || 600000); S.target = 0; changed(true); };
  ['round', 'potionRefreshes', 'instrumentRefreshes'].forEach(function (id) { $(id).onchange = function () { S[id] = +this.value; changed(); }; });
  $('depth').onchange = function () { S.depth = +this.value; save(); };
  $('phase').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; S.phase = b.dataset.v; changed(true); };

  /* ---------- tanks ---------- */
  function renderTanks() {
    $('tanks').innerHTML = S.tanks.map(function (t, i) {
      var cls = 'tank' + (i === S.sel ? ' sel' : '') + (t ? '' : ' empty');
      if (!t) return '<button type="button" class="' + cls + '" data-i="' + i + '" aria-label="Tank ' + (i + 1) + ', empty. Edit"><span class="n">TANK ' + (i + 1) + '</span><span class="plus">+</span><span class="small">Empty</span></button>';
      var a = ARCH.filter(function (x) { return x[0] === t.archetype; })[0];
      return '<button type="button" class="' + cls + '" data-i="' + i + '" aria-label="Tank ' + (i + 1) + ': ' + a[1] + ' ' + t.rarity + '. Edit"><span class="n">TANK ' + (i + 1) + '</span><span class="glyph a-' + t.archetype + '">' + a[2] + '</span><span class="name">' + a[1] + '</span><span class="badge r-' + t.rarity + '">' + t.rarity + '</span><div class="nums">' + fmt(t.activity) + ' × ' + fmt(t.quantity) + '<div class="total">' + fmt(t.activity * t.quantity) + '</div></div></button>';
    }).join('');
  }
  $('tanks').onclick = function (e) { var b = e.target.closest('.tank'); if (!b) return; var i = +b.dataset.i; S.sel = S.sel === i ? -1 : i; if (S.sel >= 0 && !S.tanks[i]) S.tanks[i] = { archetype: 'pest', rarity: 'normal', activity: 1, quantity: 36 }; renderTanks(); renderEditor(); changed(); };
  function renderEditor() {
    var i = S.sel, t = S.tanks[i];
    if (i < 0 || !t) { $('editor').innerHTML = ''; return; }
    $('editor').innerHTML = '<div class="editor">' +
      '<label class="f">Archetype<select id="e_arch">' + ARCH.map(function (a) { return '<option value="' + a[0] + '"' + (a[0] === t.archetype ? ' selected' : '') + '>' + a[1] + '</option>'; }).join('') + '</select></label>' +
      '<label class="f">Rarity<select id="e_rar">' + RAR.map(function (r) { return '<option' + (r === t.rarity ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select></label>' +
      '<label class="f">Activity<input type="number" id="e_act" min="0" value="' + t.activity + '"></label>' +
      '<label class="f">Quantity<input type="number" id="e_qty" min="0" value="' + t.quantity + '"></label>' +
      '<div class="btns"><button type="button" class="btn danger" id="e_rm">Empty tank ' + (i + 1) + '</button></div></div>';
    $('e_arch').onchange = function () { t.archetype = this.value; refresh(); };
    $('e_rar').onchange = function () { t.rarity = this.value; var b = BASE[this.value]; t.activity = b[0]; t.quantity = b[1]; $('e_act').value = b[0]; $('e_qty').value = b[1]; refresh(); };
    $('e_act').oninput = function () { t.activity = Math.max(0, +this.value || 0); refresh(); };
    $('e_qty').oninput = function () { t.quantity = Math.max(0, +this.value || 0); refresh(); };
    $('e_rm').onclick = function () { S.tanks[i] = null; S.sel = -1; renderTanks(); renderEditor(); changed(); };
    function refresh() { renderTanks(); changed(); }
  }
  function ua() { return S.tanks.reduce(function (s, t) { return s + (t ? t.activity * t.quantity : 0); }, 0); }
  function renderThresholds() {
    var u = ua();
    var one = function (v, l) { return '<span class="' + (u >= v ? 'hit' : '') + '">' + l + ' <b>' + fmt(v) + '</b>' + (u >= v ? ' ✓' : '') + '</span>'; };
    $('thresholds').innerHTML = '<span>Ultimate Activity now <b>' + fmt(u) + '</b></span>' + one(8000, 'Instrument at') + one(28000, 'Instrument at') + one(target(), 'Target');
  }

  /* ---------- instruments & hand ---------- */
  function opts(list, cur, group) {
    var h = '<option value="">—</option>';
    if (group) { ['rare', 'magic', 'normal', 'supreme'].forEach(function (g) { var l = list.filter(function (p) { return p.rarity === g; }); if (l.length) h += '<optgroup label="' + g[0].toUpperCase() + g.slice(1) + '">' + l.map(function (p) { return '<option' + (p.name === cur ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</optgroup>'; }); }
    else { ['basic', 'advanced'].forEach(function (g) { h += '<optgroup label="' + g[0].toUpperCase() + g.slice(1) + '">' + list.filter(function (p) { return p.pool === g; }).map(function (p) { return '<option' + (p.name === cur ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</optgroup>'; }); }
    return h;
  }
  function renderCards() {
    $('instruments').innerHTML = [0, 1, 2].map(function (i) { return '<label class="f">Equipped instrument ' + (i + 1) + '<select data-k="inst" data-i="' + i + '">' + opts(CAT.instruments, S.instruments[i], false) + '</select></label>'; }).join('');
    var pot = S.phase === 'potion', n = pot ? S.handSize : (S.handSize === 1 ? 1 : 3);
    $('handTitle').textContent = pot ? 'Potions on offer' : 'Instruments on offer';
    $('handHint').textContent = pot ? 'The cards you can pick from' : 'Pick one';
    $('handOpts').innerHTML = !pot ? '<label class="f">Cards shown<select id="handSize"><option value="3">3</option><option value="1">1</option></select></label>' : '<label class="f">Cards shown<select id="handSize"><option value="3">3</option><option value="5">5 (Large kit)</option></select></label><label class="f" style="grid-template-columns:auto 1fr;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:13px"><input type="checkbox" id="fromBox"' + (S.fromBox ? ' checked' : '') + ' style="width:auto"> I opened a Potion Kit</label>';
    if (pot) $('handSize').value = String(S.handSize === 5 ? 5 : 3);
    else { $('handSize').value = S.handSize === 1 ? '1' : '3'; $('handSize').onchange = function () { S.handSize = +this.value; renderCards(); changed(); }; }
    var list = pot ? CAT.potions : CAT.instruments;
    $('hand').innerHTML = Array.from({ length: n }, function (_, i) { return '<label class="f">Card ' + (i + 1) + '<select data-k="hand" data-i="' + i + '">' + opts(list, S.hand[i], pot) + '</select></label>'; }).join('');
    if (pot) { $('handSize').onchange = function () { S.handSize = +this.value; renderCards(); changed(); }; $('fromBox').onchange = function () { S.fromBox = this.checked; changed(); }; }
    showCardText();
  }
  function showCardText() {
    var pot = S.phase === 'potion', list = pot ? CAT.potions : CAT.instruments, n = pot ? S.handSize : (S.handSize === 1 ? 1 : 3);
    $('handText').innerHTML = S.hand.slice(0, n).map(function (nm) { var c = list.filter(function (x) { return x.name === nm; })[0]; return c ? '<div><b style="color:var(--ink)">' + esc(c.name) + '</b> · ' + esc(c.text) + '</div>' : ''; }).join('');
  }
  document.addEventListener('change', function (e) {
    var el = e.target; if (el.tagName !== 'SELECT' || !el.dataset.k) return;
    if (el.dataset.k === 'inst') { S.instruments[+el.dataset.i] = el.value; if (S.instRounds) S.instRounds[+el.dataset.i] = 0; } else { S.hand[+el.dataset.i] = el.value; showCardText(); }
    changed();
  });

  /* ---------- building the engine input ---------- */
  function input() {
    var pot = S.phase === 'potion', n = pot ? S.handSize : (S.handSize === 1 ? 1 : 3);
    return {
      tanks: S.tanks.map(function (t) { return t ? { archetype: t.archetype, rarity: t.rarity, activity: t.activity, quantity: t.quantity } : null; }),
      hand: S.hand.slice(0, n).filter(Boolean), instruments: S.instruments.filter(Boolean),
      instrumentRounds: S.instruments.map(function (nm, i) { return nm ? ((S.instRounds || [])[i] || 0) : null; }).filter(function (v) { return v !== null; }),
      phase: S.phase, round: S.round, potionRefreshes: S.potionRefreshes, instrumentRefreshes: S.instrumentRefreshes, fromBox: pot && S.fromBox,
    };
  }

  /* ---------- advice ---------- */
  var runToken = 0, running = false, timer = 0, aheadToken = 0, ADV = null, advSeq = 0, FRAME = null, frameSeqN = 0;
  function changed(retarget) { if (window.VoraxShare) VoraxShare.edited(S); if (window.VoraxDebug) VoraxDebug.edited(S); save(); syncControls(); renderThresholds(); if (retarget) { renderCards(); } clearTimeout(timer); timer = setTimeout(advice, 120); stopDeep(true); $('deepList').innerHTML = ''; $('progText').textContent = ''; }

  function label(x, r) {
    var name = x.hand[r.index];
    return esc(name) + (r.targets && r.targets.length ? ' → tank ' + r.targets.map(function (t) { return t + 1; }).join(' + ') : '');
  }
  function setRec(cls, kicker, what, why) { $('rec').innerHTML = '<div class="rec ' + cls + '"><div class="kicker">' + kicker + '</div><div class="what">' + what + '</div><div class="why">' + why + '</div></div>'; }
  // The whole-run look-ahead, over every CPU core but one (the futures split into slices); on this thread if workers can't start.
  var FUT_BASE = V.futuresFor ? V.futuresFor(V.poolSize() + 1) : 64, FUT = FUT_BASE;
  // (Vorax Helper) game speed, for players who want their runs done sooner: 'thorough' (the full look-ahead), 'fast'
  // (instruments by the board value, instantly; no automatic deep check), 'fastest' (that, and half the futures for
  // potions). Set in the app's Settings; measured in the 16-hour test, see the README.
  var SPEED = 'thorough';
  function setSpeed(v) { SPEED = v === 'fast' || v === 'fastest' ? v : 'thorough'; FUT = SPEED === 'fastest' ? Math.min(32, FUT_BASE) : FUT_BASE; }
  function lookAhead(x, tok, fail, done) {
    var settle = function (a) { if (tok === aheadToken && a) done(a); };
    var oops = function () { if (tok === aheadToken) fail(); };
    setTimeout(function () {
      if (tok !== aheadToken) return;
      try {
        if (V.ahead) V.ahead(x, FUT).then(settle, oops);
        else settle(S.phase === 'instrument' ? V.instrumentAhead(x) : V.plan(x));
      } catch (e) { oops(); }
    }, 30);
  }
  function advice() {
    ADV = { id: ++advSeq, instant: null, ahead: null, deep: null, aheadPending: false, deepPending: false, phase: S.phase, round: S.round };
    var x = input(); $('adviceKicker').textContent = ''; $('quickList').innerHTML = ''; aheadToken++; if ($('ahead')) $('ahead').innerHTML = '';
    $('run').disabled = false;
    if (S.round > 10 && S.phase === 'potion') { setRec('warn', 'Rounds 11–13', 'Nothing to play', 'There are no potions after round 10. These rounds only offer instruments, and they don\'t change your score.'); $('run').disabled = true; return; }
    var need = S.phase === 'potion' || S.handSize === 1 ? 1 : 3;
    if (x.hand.length < need) { setRec('warn', 'Waiting for cards', 'Pick the cards on offer', S.phase === 'potion' ? 'Choose at least one potion from your hand.' : 'Choose the instruments you are offered.'); $('run').disabled = true; return; }
    if (S.phase === 'instrument' && new Set(x.hand).size < x.hand.length) { setRec('warn', 'Check the offer', 'Duplicate cards', 'Each offered instrument should be different.'); $('run').disabled = true; return; }
    try {
      var tok = ++aheadToken;
      if (S.phase === 'instrument') {
        var a = V.instrumentAdvice(x), eq = x.instruments.length, board = S.instMode === 'board';
        if (eq >= 3) { setRec('warn', 'Already full', 'No pick needed', 'You already have three instruments equipped.'); $('run').disabled = true; return; }
        var tablePick = a.action === 'refresh' ? { refresh: true } : { index: a.best === null ? 0 : a.best, targets: [] };
        var stage = ['First instrument', 'Second instrument', 'Third instrument'][a.stage];
        var tableWhat = a.action === 'refresh' ? 'Refresh the offer' : 'Take ' + esc(a.rows[a.best === null ? 0 : a.best].name);
        // fast games: each offer judged at once by the value of the board it leaves (no playouts)
        if (SPEED !== 'thorough' && board && V.instrumentValue) {
          var iv = V.instrumentValue(x), vpick = iv.best === 'refresh' ? { refresh: true } : { index: iv.best, targets: [] };
          var vwhat = vpick.refresh ? 'Refresh the offer' : 'Take ' + esc(x.hand[vpick.index]);
          ADV.instant = vpick; ADV.aheadPending = false; sendPlan();
          $('adviceKicker').textContent = stage + ' · fast game: board value';
          setRec('', 'Recommended', vwhat, 'Fast game: each offer judged at once by the value of the board it leaves, instead of being played out to the end of the run (Settings \u2192 Game speed).' + (vpick.refresh ? ' Every offer leaves a weaker board than a new offer would.' : ''));
          $('quickList').innerHTML = '';
          $('ahead').innerHTML = '<div class="kicker" style="margin:16px 0 6px">Board value</div>' + iv.ranking.map(function (o) {
            var best = !vpick.refresh && o.index === vpick.index;
            return '<div class="opt' + (best ? ' best' : '') + '"><div class="lab">' + esc(x.hand[o.index]) + (best ? ' <span class="pill">Pick</span>' : '') + '</div><div class="pct">' + short(o.value) + '</div><div class="sub">expected end of the run from the board it leaves</div></div>';
          }).join('');
          return;
        }
        if (board) { ADV.aheadPending = true; $('adviceKicker').textContent = stage + ' · played out from your board'; setRec('', 'Sweep tables say', tableWhat, esc(a.why) + ' <b>Checking from your board…</b>'); }
        else { ADV.instant = tablePick; $('adviceKicker').textContent = stage + ' · sweep tables'; setRec('', 'Recommended', tableWhat, esc(a.why)); }
        sendPlan();
        $('quickList').innerHTML = '<div class="kicker" style="margin:4px 0 6px">Sweep tables</div>' + a.rows.slice().sort(function (p, q) { return (q.value || 0) - (p.value || 0); }).map(function (r) {
          var v = r.value === null ? null : r.value * 100;
          return '<div class="opt' + (a.action === 'take' && r.index === a.best ? ' best' : '') + '"><div class="lab">' + esc(r.name) + '</div><div class="pct">' + (v === null ? '—' : v.toFixed(0) + '%') + '</div><div class="track"><div class="fill" style="width:' + (v || 0) + '%"></div></div><div class="sub">' + (v === null ? 'no sweep data for this pairing' : 'chance to reach 850,000 with this pairing, from simulation sweeps') + '</div></div>';
        }).join('');
        // upstream's way: each offer (and a refresh) played to the end of the run from this exact board (a few seconds)
        $('ahead').innerHTML = '<div class="note">Playing each offer out from your board…</div>';
        lookAhead(x, tok, function () { $('ahead').innerHTML = ''; if (board) { ADV.instant = tablePick; ADV.aheadPending = false; sendPlan(); } }, function (r) {
          var pick = r.best === 'refresh' ? { refresh: true } : r.best ? { index: r.best.index, targets: [] } : tablePick;
          var name = function (i) { return esc(x.hand[i]); };
          var what = pick.refresh ? 'Refresh the offer' : 'Take ' + name(pick.index);
          var same = !!pick.refresh === !!tablePick.refresh && (pick.refresh || pick.index === tablePick.index);
          if (board) {
            ADV.instant = pick; ADV.aheadPending = false; sendPlan();
            setRec('', 'Recommended', what, 'Each offer played to the end of the run ' + FUT + ' times from your board: ' + (pick.refresh ? 'refreshing ends higher on average than any offer.' : 'ends around ' + short(r.ranking[0].value) + ' on average.') + (same ? ' The sweep tables agree.' : ' The sweep tables said: ' + tableWhat + '.'));
          } else if (!same) {
            $('rec').insertAdjacentHTML('beforeend', '<div class="note" style="margin-top:8px">Played out from your board, <b>' + what + '</b> ends higher on average. Settings → Advice can make that the recommendation.</div>');
          }
          $('ahead').innerHTML = '<div class="kicker" style="margin:16px 0 6px">Played out from your board</div>' + r.ranking.map(function (o) {
            var best = !pick.refresh && o.index === pick.index;
            return '<div class="opt' + (best ? ' best' : '') + '"><div class="lab">' + name(o.index) + (best ? ' <span class="pill">Board pick</span>' : '') + '</div><div class="pct">' + short(o.value) + '</div><div class="sub">average end of the run with this instrument</div></div>';
          }).join('') + (pick.refresh ? '<div class="opt best"><div class="lab">Refresh the offer <span class="pill">Board pick</span></div><div class="sub">a new offer ends higher on average</div></div>' : '') + '<div class="note">' + FUT + ' playouts per offer from your exact tanks, later rounds played by the simulator’s smarter player (its board value).</div>';
        });
        return;
      }
      var q = V.quick(x);
      ADV.instant = q.best === 'refresh' ? { refresh: true } : q.best ? { index: q.best.index, targets: q.best.targets || [] } : null;
      if (q.note) ADV.ahead = ADV.instant;   // a rule (Xenopanacea): nothing more to wait for
      else ADV.aheadPending = true;
      sendPlan();
      if (q.unknown && q.unknown.length) { setRec('warn', 'Unknown card', esc(q.unknown.join(', ')), 'That name is not in the game data.'); return; }
      if (q.note) { $('adviceKicker').textContent = 'Rule'; setRec('', 'Recommended', label(x, q.best), esc(q.note)); $('run').disabled = true; return; }
      var quickWhat = q.best === 'refresh' ? 'Refresh the hand' : q.best ? label(x, q.best) : 'Any card';
      $('adviceKicker').textContent = 'Quick answer · looking ahead…';
      setRec('', 'For this round', quickWhat, 'Best for this round alone. The whole-run look-ahead is checking every option to the end of the run (about a second).');
      $('quickList').innerHTML = '<div class="kicker" style="margin:4px 0 6px">This round only · expected Ultimate Activity after it</div>' + q.ranking.slice(0, 5).map(function (r, i) {
        return '<div class="opt' + (i === 0 ? ' best' : '') + '"><div class="lab">' + label(x, r) + '</div><div class="pct">' + short(r.value) + '</div></div>';
      }).join('') + (q.ranking.length > 5 ? '<div class="note">' + (q.ranking.length - 5) + ' weaker plays not shown.</div>' : '');
      // the recommendation: upstream's whole-run look-ahead, every card and a reroll played to the end of the run
      $('ahead').innerHTML = '<div class="note">Looking ahead to the end of the run…</div>';
      // upstream's goal: 950k on the board, which the endgame bonus takes to rainbow
      lookAhead(x, tok, function () { $('ahead').innerHTML = ''; ADV.aheadPending = false; sendPlan(); $('adviceKicker').textContent = 'Quick answer'; }, function (a) {
        ADV.ahead = a.best === 'refresh' ? { refresh: true } : a.best ? { index: a.best.index, targets: a.best.targets || [] } : null; ADV.aheadPending = false; sendPlan();
        if (!a.ranking.length) { $('ahead').innerHTML = ''; return; }
        var rows = a.ranking.slice(0, 4).map(function (r) { return { lab: label(x, r) + (r.noEffect ? ' <span class="pill">does nothing here</span>' : ''), end: r.end, even: !!r.even, best: a.best !== 'refresh' && a.best && a.best.index === r.index && String(a.best.targets) === String(r.targets) }; });
        if (a.refreshEnd) rows.push({ lab: 'Refresh the hand', end: a.refreshEnd, best: a.best === 'refresh' });
        rows.sort(function (p, q) { return q.end.activity - p.end.activity; });
        var top = rows.filter(function (r) { return r.best; })[0] || rows[0];
        var aheadWhat = a.best === 'refresh' ? 'Refresh the hand' : top.lab;
        var agrees = aheadWhat === quickWhat;
        $('adviceKicker').textContent = 'Whole-run look-ahead';
        // every option within the margin of error of the best, future by future (tli-warden's "Take any"): said so, the
        // best by a hair still named (and still what the click helper plays)
        if (a.allEven) setRec('', 'Any of them', S.phase === 'instrument' ? 'Take any instrument' : 'Any play is as good', 'The look-ahead can\u2019t tell the options apart: played to the end of the run ' + FUT + ' times each, they end within the margin of error of each other. ' + aheadWhat + ' is ahead by a hair (ends around ' + short(top.end.activity) + ').');
        else setRec('', 'Recommended', aheadWhat, 'Played to the end of the run ' + FUT + ' times per option: ends around ' + short(top.end.activity) + ' on average, and ' + Math.round(top.end.reached * 100) + '% of those runs reach 950k (rainbow after the endgame bonus). ' + (agrees ? 'The quick answer agrees.' : 'The quick answer (best for this round alone) was ' + quickWhat + '; the look-ahead plays better over the whole run.'));
        $('ahead').innerHTML = '<div class="kicker" style="margin:16px 0 6px">Whole-run look-ahead</div>' + rows.map(function (r) {
          var pct = Math.round(r.end.reached * 100);
          return '<div class="opt' + (r.best ? ' best' : '') + '"><div class="lab">' + r.lab + (r.best ? ' <span class="pill">Look-ahead pick</span>' : '') + (r.even ? ' <span class="pill grey">As good</span>' : '') + '</div><div class="pct">' + short(r.end.activity) + '</div><div class="track"><div class="fill" style="width:' + pct + '%"></div></div><div class="sub">predicted end of the run · ' + pct + '% of playouts reach 950k</div></div>';
        }).join('') + '<div class="note">' + FUT + ' playouts per option, the rounds inside played by the simulator’s smarter player (its board value), aiming at 950k as it does. The deep check below aims at your own target.</div>';
      });
    } catch (err) { setRec('warn', 'Something went wrong', 'Could not read the board', esc(err && err.message ? err.message : err)); }
  }

  /* ---------- deep check ---------- */
  function stopDeep(silent) { runToken++; if (running) { running = false; $('stop').hidden = true; $('run').hidden = false; $('progWrap').hidden = true; if (!silent) $('progText').textContent = 'Stopped.'; } }
  function renderRows(rows) {
    var x = input();
    $('deepList').innerHTML = rows.map(function (r, i) {
      var p = r.p * 100;
      var sub = r.n + ' playouts · average ' + short(r.mean) + ' · 1 in 10 runs finish below ' + short(r.p10);
      var vs = i === 0 || r.out ? '' : ' · ' + (r.diff * 100 >= 0 ? '+' : '') + (r.diff * 100).toFixed(0) + ' pts vs best (±' + (r.diffCi * 100).toFixed(0) + ')';
      var lab = r.refresh ? 'Refresh the hand' : (S.phase === 'potion' ? label(x, { index: r.index, targets: r.targets }) : esc(x.hand[r.index]));
      return '<div class="opt' + (i === 0 && !r.out ? ' best' : '') + (r.out ? ' out' : '') + '"><div class="lab">' + lab + (i === 0 && !r.out ? ' <span class="pill">Best</span>' : '') + (r.out ? ' <span class="pill grey">Ruled out</span>' : '') + '</div><div class="pct">' + p.toFixed(0) + '%</div><div class="track"><div class="fill" style="width:' + p + '%"></div><div class="ci" style="left:' + (r.lo * 100) + '%;width:' + Math.max(0, (r.hi - r.lo) * 100) + '%"></div></div><div class="sub">' + sub + vs + '</div></div>';
    }).join('');
  }
  $('run').onclick = function () {
    var x = input(); stopDeep(true); var tok = ++runToken; running = true; $('run').hidden = true; $('stop').hidden = false; $('progWrap').hidden = false; $('prog').style.width = '0';
    $('progText').textContent = 'Playing the options out…'; $('deepList').innerHTML = '';
    ADV.deepPending = true; sendPlan();
    V.check(x, target(), { playouts: S.depth, maxOptions: 6, shouldStop: function () { return tok !== runToken; }, onUpdate: function (rows, done, total) { if (tok !== runToken) return; renderRows(rows); $('prog').style.width = (100 * done / total) + '%'; $('progText').textContent = done + ' of ' + total + ' playouts'; } })
      .then(function (rows) { if (tok !== runToken) return; running = false; if (rows[0]) { ADV.deep = rows[0].refresh ? { refresh: true } : { index: rows[0].index, targets: rows[0].targets || [] }; ADV.deepPending = false; sendPlan(); } $('stop').hidden = true; $('run').hidden = false; $('progWrap').hidden = true; if (!rows.length) { $('progText').textContent = 'Nothing to check for this board.'; return; } renderRows(rows); var b = rows[0]; $('progText').textContent = 'Done. Best: ' + (b.refresh ? 'refresh the hand' : $('deepList').querySelector('.lab').textContent.replace(/Best|Ruled out/g, '').trim()) + ' (' + (b.p * 100).toFixed(0) + '% to reach ' + fmt(target()) + ').'; })
      .catch(function (e) { running = false; $('stop').hidden = true; $('run').hidden = false; $('progWrap').hidden = true; $('progText').innerHTML = '<span class="err">' + esc(e && e.message ? e.message : e) + '</span>'; });
  };
  $('stop').onclick = function () { stopDeep(); };

  /* ---------- example / clear ---------- */
  $('example').onclick = function () {
    var s = fresh(); s.target = S.target; s.custom = S.custom; s.depth = S.depth; s.round = 6; s.phase = 'potion'; s.potionRefreshes = 2; s.instrumentRefreshes = 1;
    s.tanks = [{ archetype: 'pest', rarity: 'magic', activity: 5, quantity: 330 }, { archetype: 'pest', rarity: 'normal', activity: 1, quantity: 156 }, { archetype: 'boneSentry', rarity: 'rare', activity: 15, quantity: 52 }, { archetype: 'agito', rarity: 'magic', activity: 65, quantity: 24 }, null, null];
    s.instruments = ['Incubation Sac', 'Lady of the Plague Quarter', '']; s.hand = ['Insect Attractant', 'Xeno-Hormone', 'Slough Solution', '', ''];
    S = s; boot();
  };
  $('clear').onclick = function () { var s = fresh(); s.target = S.target; s.custom = S.custom; s.depth = S.depth; S = s; boot(); };

  function boot() { syncControls(); renderTanks(); renderEditor(); renderCards(); renderThresholds(); advice(); $('deepList').innerHTML = ''; $('progText').textContent = ''; save(); }

  /* ---------- reading the game: screenshot and live ---------- */
  var scanner = null, live = null, tracker = V.newTracker(), reading = false, unsureKeys = [], FOLDERS = [
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Torchlight Infinite\\UE_game\\TorchLight\\Saved\\Logs',
    'C:\\Program Files (x86)\\Torchlight Infinite\\Game\\UE_game\\Torchlight\\Saved\\Logs',
    'D:\\SteamLibrary\\steamapps\\common\\Torchlight Infinite\\UE_game\\TorchLight\\Saved\\Logs'];
  var getScanner = function () { return scanner || (scanner = V.createScanner()); };
  var NAME = { activity: 'Activity', quantity: 'Quantity', archetype: 'type', rarity: 'rarity', empty: 'slot' };
  function niceField(k) {
    var m = /^tank(\d)\.(\w+)$/.exec(k); if (m) return 'Tank ' + (+m[1] + 1) + ' ' + (NAME[m[2]] || m[2]);
    m = /^hand(\d)$/.exec(k); if (m) return 'Card ' + (+m[1] + 1);
    m = /^instrument(\d)$/.exec(k); if (m) return 'Instrument ' + (+m[1] + 1);
    if (k === 'ultimate') return 'Tank numbers don\u2019t add up to Ultimate Activity';
    return { round: 'Round', phase: 'Phase', refreshes: 'Refreshes left' }[k] || k;
  }
  function setStatus(t, cls) { $('readStatus').innerHTML = cls ? '<span class="' + cls + '">' + esc(t) + '</span>' : esc(t); }
  function dbgRead(raw, trigger, img, ms, extra) {
    if (!window.VoraxDebug || !img) return;
    VoraxDebug.read(img, Object.assign({ src: live ? 'live' : 'shot', trigger: trigger || null, ms: ms, crop: raw.crop || null, fields: raw.fields,
      problems: raw.problems.map(function (p) { return p.field ? p.kind + ':' + p.field : p.name ? p.kind + ':' + p.name : p.kind; }),
      handShift: raw.handShift || null, ui: raw.ui || null, tanksRaw: raw.debug && raw.debug.tanks, colours: raw.debug ? { off: raw.debug.off, corrected: raw.debug.corrected } : null,
      state: raw.state, board: VoraxDebug.board(S), ocr: V.ocrEngine ? V.ocrEngine() : null }, extra || {}));
  }
  // cards the reader didn't recognise, with the title it read: sent (once each) so new cards are known early, but only
  // when the next look still can't name the same card in the same place: a card caught sliding in, cut off or under the
  // pointer is read fine a moment later (upstream's fix, 2026-10-21). A card missed for the first time gets that look.
  var unknownSeen = {};
  function newCards(raw, img) {
    var st = raw.state, now = {}, fresh = false;
    if (st.phase !== 'protocol') raw.problems.forEach(function (p) {
      if (p.kind !== 'unknownArt' || !p.text || !p.crop) return;
      var key = [st.phase, st.round, p.field, p.text.toLowerCase()].join('|');
      now[key] = true;
      if (!unknownSeen[key]) { fresh = true; return; }
      if (!window.VoraxShare || !VoraxShare.unknownCard || !img) return;
      var c = raw.crop || {}, r = { x: p.crop.x + (c.left || 0), y: p.crop.y + (c.top || 0), w: p.crop.w, h: p.crop.h };
      VoraxShare.unknownCard(st.phase, p.text, img, r);
    });
    unknownSeen = now;
    if (fresh && live && live.snapNow) setTimeout(function () { if (live) live.snapNow(); }, 1500);
  }
  // a board whose tank numbers are mostly unreadable (the first frame of a window share, a card sliding over them) isn't
  // the board: the last one is kept. Asked of the first reading too, so the cards of such a picture aren't read at all.
  function unclear(raw) {
    var present = 0, shaky = 0;
    raw.state.tanks.forEach(function (x, i) { if (!x) return; present++; var f = raw.fields['tank' + i + '.activity']; if (f && !f.sure) shaky++; });
    return !!lastSig && shaky >= 2 && shaky * 2 >= present;
  }
  function handHidden(raw) {
    var f = raw.fields.phase, hand = raw.state.hand || [];
    if (f && f.sure) return false;
    return !hand.length || hand.some(function (n) { return !n; }) || raw.problems.some(function (p) { return p.kind === 'unknownArt'; });
  }
  function applyReading(raw, trigger, img, ms) {
    if (raw.problems.some(function (p) { return p.kind === 'animating'; })) { dbgRead(raw, trigger, img, ms, { kept: 'animating' }); return; }       // a card is mid-flight: keep the last board
    if (raw.problems.some(function (p) { return p.kind === 'notFound'; })) { dbgRead(raw, trigger, img, ms, { kept: 'notFound' }); setStatus(live ? 'Waiting for the Surgical Preparation screen\u2026 (this picture is another screen of the game)' : 'That doesn\u2019t look like the Surgical Preparation screen.', live ? '' : 'err'); return; }
    var st0 = raw.state;
    // a picture caught mid-change: rounds 1-10 never show a protocol pick, and a board whose tank numbers are mostly
    // unreadable (the first frame of a window share, a card sliding over them) isn't the board: keep the last one
    if (st0.phase === 'protocol' && st0.round && st0.round <= 10 && raw.fields.round && raw.fields.round.sure) { dbgRead(raw, trigger, img, ms, { kept: 'protocol before round 11' }); return; }
    if (unclear(raw)) { dbgRead(raw, trigger, img, ms, { kept: 'unclear picture' }); return; }
    // a card picked and raised (the game waits for its tanks) covers the "Select a ..." header and the names beside
    // it: the hand can't be read, and the board is the one read before it
    if (handHidden(raw)) {
      dbgRead(raw, trigger, img, ms, { kept: 'hand covered' });
      if (trigger === 'watch' && live && live.watchResult) live.watchResult(true);
      if (!lastSig) setStatus('A raised card covers the hand \u2014 move the pointer off the cards to read it.', '');
      return;
    }
    newCards(raw, img);
    var t = V.trackInstruments(tracker, raw, trigger); tracker = t.tracker;
    // the same board read again (the screen watch sees a card light up under the pointer, say): the advice stands,
    // only the picture is newer, so the card and the click helper don't flicker between answers
    var sig = JSON.stringify([st0.round, st0.phase, st0.hand, st0.tanks, st0.potionRefreshes, st0.instrumentRefreshes, t.instruments]);
    if (sig === lastSig && ADV && FRAME && img) {
      FRAME = Object.assign({}, FRAME, { id: ++frameSeqN, t: Date.now() });
      dbgRead(raw, trigger, img, ms, { kept: 'same board' });
      if (trigger === 'watch' && live && live.watchResult) live.watchResult(true);
      sendPlan(); return;
    }
    lastSig = sig;
    if (live && live.watchResult) live.watchResult(false);
    var fields = {}; Object.keys(raw.fields).forEach(function (k) { if (k.indexOf('instrument') !== 0) fields[k] = raw.fields[k]; });
    Object.keys(t.fields).forEach(function (k) { fields[k] = t.fields[k]; });
    var st = raw.state, s = S;
    s.phase = st.phase === 'protocol' ? 'potion' : st.phase;
    s.round = st.round || s.round;
    if (st.potionRefreshes != null) s.potionRefreshes = Math.min(3, st.potionRefreshes);
    if (st.instrumentRefreshes != null) s.instrumentRefreshes = Math.min(2, st.instrumentRefreshes);
    s.tanks = st.tanks.map(function (x) { return x ? { archetype: x.archetype, rarity: x.rarity, activity: x.activity, quantity: x.quantity } : null; });
    // numbers too unclear to read start at that rarity's base stats rather than a meaningless 1 x 1 (still flagged to check)
    s.tanks.forEach(function (tk, i) { if (!tk) return; var f = fields['tank' + i + '.activity'], g = fields['tank' + i + '.quantity'], b = BASE[tk.rarity];
      if (f && g && !f.sure && !g.sure && b && (tk.activity * tk.quantity < b[0] * b[1] || tk.activity > 3000 || tk.quantity > 5000)) { tk.activity = b[0]; tk.quantity = b[1]; } });
    // a starting item (Limb-Stitching Specimen, the teal ewer) shapes the starting tanks only: never one of the three picks
    var picks = [], pickRounds = [];
    t.instruments.forEach(function (n, i) { if (n && !/starting item|limb-stitching/i.test(n)) { picks.push(n); pickRounds.push((t.rounds || [])[i] || 0); } });
    s.instruments = ['', '', ''].map(function (_, i) { return picks[i] || ''; });
    s.instRounds = [0, 1, 2].map(function (i) { return pickRounds[i] || 0; });   // the round each was picked in: an instrument's bonus grows from then
    // potions: 3 cards, or 5 from a Large kit; instruments: 3, or now and then a single card
    var n = st.phase === 'potion' ? (st.hand.length >= 4 || raw.handSize === 5 ? 5 : 3) : (raw.handSize === 1 || st.hand.length === 1 ? 1 : 3);
    if (st.phase === 'instrument') s.handSize = n;
    if (st.phase === 'potion') { s.handSize = n; s.fromBox = n === 5; }   // five cards can only be an opened Large kit
    s.hand = ['', '', '', '', ''].map(function (_, i) { return st.phase === 'protocol' ? '' : (st.hand[i] || ''); });
    s.sel = -1;
    // the Ultimate Activity number is a check on the tanks: unreadable is no problem, but tanks that don't add up to it are
    var ua = fields.ultimate, uaNote = ua && ua.note || '';
    unsureKeys = Object.keys(fields).filter(function (k) { return fields[k] && (k === 'ultimate' ? /^mismatch/.test(uaNote) : fields[k].sure === false); });
    var unk = raw.problems.filter(function (p) { return p.kind === 'unknownArt' || p.kind === 'unknownName'; }).length;
    var lines = unsureKeys.map(function (k) { return '<div class="warnrow">Check: ' + esc(niceField(k)) + (fields[k].guess ? ' (read as ' + esc(fields[k].guess) + ')' : '') + '</div>'; });
    var fixedTank = /^fixed tank(\d)/.exec(uaNote);
    if (fixedTank) lines.push('<div class="note">Tank ' + (+fixedTank[1] + 1) + ' was misread; its Activity \u00d7 Quantity was worked out from Ultimate Activity (' + esc(ua.guess) + '). Fix it if it looks wrong.</div>');
    if (unk) lines.push('<div class="warnrow">' + unk + ' card' + (unk > 1 ? 's' : '') + ' not recognised. Pick ' + (unk > 1 ? 'them' : 'it') + ' in the card list below.</div>');
    if (t.ask) lines.push('<div class="warnrow">Check which instrument you picked last, in the equipped list.</div>');
    if (st.phase === 'protocol') lines.push('<div class="note">Protocol pick (rounds 11\u201313): it doesn\u2019t change your Ultimate Activity, so there is nothing to optimise.</div>');
    $('readCheck').innerHTML = lines.join('');
    setStatus((raw.crop && (raw.crop.top || raw.crop.bottom || raw.crop.left || raw.crop.right) ? 'Trimmed the window\u2019s title bar / taskbar. ' : '') + 'Read the board: round ' + s.round + ', ' + (st.phase === 'potion' ? 'potion' : st.phase === 'protocol' ? 'protocol' : 'instrument') + ' pick' + (unsureKeys.length || unk ? '.' : ', all fields clear.') + (scanner && scanner.ocr ? '' : ''), '');
    boot();
    if (window.VoraxShare) VoraxShare.board(S, live ? 'live' : 'shot', trigger, unsureKeys.concat(unk ? ['card'] : []));
    dbgRead(raw, trigger, img, ms, { unsure: unsureKeys, askedPick: !!t.ask });
    // (Vorax Helper) tank numbers that don't add up to Ultimate Activity are often a picture caught while they count up
    // after a potion: looked at again a moment later before the click helper acts on it (once per board)
    var uaOff = /^mismatch/.test(uaNote), uaKey = [st.round, st.phase, st.hand.join('|')].join('#'), holdForUa = false;
    if (uaOff && live && uaKey !== uaRetried) { uaRetried = uaKey; holdForUa = true; setTimeout(function () { if (live) live.snapNow(); }, 900); }
    if (img) FRAME = { id: ++frameSeqN, t: Date.now(), w: img.width, h: img.height, crop: raw.crop || { top: 0, bottom: 0 }, shift: raw.handShift || [0, 0], ui: raw.ui || 1, unsure: unsureKeys.length + unk, hold: holdForUa ? 'the tank numbers don’t add up to Ultimate Activity: looking again' : '', phase: st.phase, live: !!live, area: live ? snapArea : null, tankFix: raw.tankFix || null };
    dbgCount();
    unsureKeys.forEach(function (k) { var m = /^tank(\d)/.exec(k); if (m) { var el = $('tanks').children[+m[1]]; if (el) el.classList.add('unsure'); } });
    if (live && $('autoDeep').checked && SPEED === 'thorough' && st.phase !== 'protocol' && !$('run').disabled) { S.depth = 30; $('depth').value = '30'; $('run').click(); }
  }
  var pendingRead = null, lastSig = '';   // the newest picture that came while another was being read: read next, not dropped
  function readImage(img, trigger) {
    if (reading) { pendingRead = { img: img, trigger: trigger }; return; }
    reading = true; setStatus('Reading the picture\u2026');
    var t0 = Date.now();
    getScanner()(img, trigger, undefined, { skip: unclear }).then(function (r) { applyReading(r, trigger, img, Date.now() - t0); }).catch(function (e) { setStatus('Could not read that picture: ' + (e && e.message ? e.message : e), 'err'); }).then(function () {
      reading = false;
      if (pendingRead) { var n = pendingRead; pendingRead = null; readImage(n.img, n.trigger); }
    });
  }
  function fromFile(f) { if (!f || !/^image\//.test(f.type)) return setStatus('That isn\u2019t an image.', 'err'); tracker = V.newTracker(); V.imageData(f).then(function (d) { readImage(d, undefined); }); }
  var drop = $('shotDrop');
  drop.onclick = function () { $('shotFile').click(); };
  drop.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('shotFile').click(); } };
  $('shotFile').onchange = function () { fromFile(this.files[0]); this.value = ''; };
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { fromFile(e.dataTransfer.files[0]); });
  document.addEventListener('paste', function (e) { var it = Array.prototype.filter.call(e.clipboardData ? e.clipboardData.items : [], function (i) { return /^image\//.test(i.type); })[0]; if (it) { e.preventDefault(); fromFile(it.getAsFile()); } });

  $('srcTabs').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
    $('srcShot').hidden = b.dataset.v !== 'shot'; $('srcLive').hidden = b.dataset.v !== 'live'; $('srcManual').hidden = b.dataset.v !== 'manual';
    if (b.dataset.v === 'live') renderLive();
  };

  var liveOk = typeof window.showOpenFilePicker === 'function' && navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function';
  var appShare = null, liveNote = '', snapArea = null, uaRetried = '';
  var logDetailOff = false, logHandle = null, liveStats = { lines: 0, frames: 0, detail: false, over: false }, liveErr = '';
  function setSteps(n) { Array.prototype.forEach.call($('liveSteps').children, function (li, i) { li.dataset.s = i + 1 < n ? 'done' : i + 1 === n ? 'now' : 'later'; }); }
  function startLive() {
    if (live) return live;
    live = V.createLive({
      onSnap: function (img, kind) { if (window.VoraxDebug) VoraxDebug.event('snap', { kind: kind }); liveStats.frames++; snapArea = live ? live.frameArea : null; readImage(img, kind); renderLive(); },
      onStatus: function (s) { var dOff = s.lines > 400 && !s.detailSeen; if (dOff !== logDetailOff) { logDetailOff = dOff; if (window.VoraxDesktop && VoraxDesktop.logDetail) VoraxDesktop.logDetail(!dOff); renderLive(); } if (window.VoraxDebug && (s.over !== liveStats.over || s.detailSeen !== liveStats.detail)) VoraxDebug.event('log-status', s); liveStats.lines = s.lines; liveStats.detail = s.detailSeen; liveStats.over = s.over; var n = $('liveCount'); if (n) n.textContent = counts(); },
      onError: function (m) {
        if (window.VoraxDebug) VoraxDebug.event('live-error', { message: String(m).slice(0, 300) });
        // in the app, a refused window capture isn't the player's problem: the app takes its own pictures meanwhile and
        // tries the capture again (appShare), so it's a quiet note, not an error
        if (window.VoraxDesktop && /NotReadableError|Could not start video source|AbortError|NotFoundError/i.test(String(m))) { liveNote = 'Windows refused the game window capture: the app takes its own pictures of the game meanwhile and tries the capture again.'; renderLive(); return; }
        liveErr = m; renderLive();
      },
      onEnded: function () { renderLive(); if (window.VoraxDesktop && appShare) appShare(0, 3000); }
    });
    return live;
  }
  function counts() { return liveStats.frames + ' picture' + (liveStats.frames === 1 ? '' : 's') + ' \u00b7 ' + liveStats.lines + ' log lines read' + (liveStats.over ? ' \u00b7 Game over. Waiting for the next one.' : ''); }
  function connect(getHandle) { liveErr = ''; getHandle().then(function (h) { logHandle = h; tracker = V.newTracker(); startLive().connectLog(h); renderLive(); }).catch(function (e) { if (e && e.name !== 'AbortError') { liveErr = String(e); renderLive(); } }); }
  function renderLive() {
    var body = $('liveBody');
    if (!liveOk) { body.innerHTML = '<div class="note">Live needs Chrome or Edge on a PC (it uses window sharing and file access). Screenshot and Manual work in any browser.</div>'; return; }
    var step = !logHandle ? 1 : !(live && (live.sharing || window.VoraxDesktop)) ? 2 : 3; setSteps(step); var h = '';   // the app can take its own pictures
    if (window.VoraxDesktop && step < 3) { body.innerHTML = '<div class="note">' + (step === 1 ? 'Waiting for Torchlight: Infinite to start. The app finds the game log and window by itself.' : 'Found the game. Connecting to its window\u2026') + '</div>' + (liveErr ? '<div class="note err">' + esc(liveErr) + '</div>' : ''); return; }
    if (step === 1) {
      h = '<label class="drop" id="logDrop"><b>Drag UE_game.log here</b><span>from the game\u2019s log folder in File Explorer</span><button type="button" class="btn" id="logPick">Choose the file</button></label>' +
        '<p class="note">First turn the game\u2019s log on: press Esc, open <b>Account Related</b>, click <b>Enable Log</b>, then log out and back in. The log folder is usually one of:</p>' +
        FOLDERS.map(function (f, i) { return '<div class="code"><span>' + esc(f) + '</span><button type="button" class="btn" data-copy="' + i + '">Copy</button></div>'; }).join('') +
        '<p class="note">Chrome can\u2019t browse into Program Files from its file window; drag the file in instead.</p>';
    } else if (step === 2) {
      h = '<button type="button" class="btn primary" id="shareBtn">Share the game window</button><p class="note">Pick the Torchlight: Infinite window. Only that window is seen, and only when the log shows a move.</p>';
    } else {
      h = '<div class="btns"><button type="button" class="btn primary" id="snapBtn">Snap now</button><button type="button" class="btn" id="stopBtn">Stop</button></div><div class="note" id="liveCount" style="margin-top:8px">' + counts() + '</div>' +
        (!liveStats.detail && liveStats.lines === 0 ? '<div class="note" id="noLog"></div>' : '') +
        (logDetailOff ? '<div class="warnrow" style="margin-top:8px"><b>The game\u2019s log is missing its detail lines</b>, so it can\u2019t say when you\u2019ve made a move. In the game press Esc, open <b>Account Related</b>, click <b>Enable Log</b>, then log out and back in. Until then the helper watches the screen and reads the board when it changes.</div>' : '') +
        (live && live.watching ? '<div class="note" style="margin-top:6px">Watching the screen: the board is read again after each move.</div>' : '');
    }
    if (live && live.sharing) liveNote = '';
    else if (live && live.appPictures) liveNote = 'Windows refused the game window capture, so the app takes its own pictures of the game window instead (the card and the highlight stay visible to OBS and other recorders).';
    body.innerHTML = h + (liveErr ? '<div class="note err" style="margin-top:8px">' + esc(liveErr) + '</div>' : liveNote ? '<div class="note" style="margin-top:8px">' + esc(liveNote) + '</div>' : '');
    var q = function (id) { return document.getElementById(id); };
    if (q('logPick')) q('logPick').onclick = function (e) { e.preventDefault(); connect(function () { return window.showOpenFilePicker({ types: [{ description: 'Game log', accept: { 'text/plain': ['.log'] } }] }).then(function (a) { return a[0]; }); }); };
    if (q('logDrop')) { var d = q('logDrop'); d.ondragover = function (e) { e.preventDefault(); d.classList.add('over'); }; d.ondragleave = function () { d.classList.remove('over'); }; d.ondrop = function (e) { e.preventDefault(); d.classList.remove('over'); var it = e.dataTransfer.items[0]; if (!it || !it.getAsFileSystemHandle) { liveErr = 'Your browser can\u2019t follow a dropped file. Use Chrome or Edge.'; return renderLive(); } connect(function () { return it.getAsFileSystemHandle().then(function (h) { if (!h || h.kind !== 'file') throw new Error('Drop the UE_game.log file itself.'); return h; }); }); }; }
    Array.prototype.forEach.call(body.querySelectorAll('[data-copy]'), function (b) { b.onclick = function () { try { navigator.clipboard.writeText(FOLDERS[+b.dataset.copy]); b.textContent = 'Copied'; } catch (e) { /* clipboard blocked */ } }; });
    if (q('shareBtn')) q('shareBtn').onclick = function () { liveErr = ''; startLive().share().then(function () { if (live && live.sharing) live.watchScreen(true); renderLive(); }); };
    if (q('snapBtn')) q('snapBtn').onclick = function () { live.snapNow(); };
    if (q('stopBtn')) q('stopBtn').onclick = function () { live.stop(); live = null; logHandle = null; liveStats = { lines: 0, frames: 0, detail: false, over: false }; renderLive(); };
  }
  setTimeout(function () { if (live && live.following && live.sharing && !liveStats.detail && liveStats.lines === 0) { var n = $('noLog'); if (n) n.textContent = 'No game lines yet. If this stays empty, Enable Log looks off: Esc, Account Related, Enable Log, then log out and back in.'; } }, 30000);
  renderLive();



  /* ---------- the move as places on the picture: for the highlight and the click helper (desktop app) ---------- */
  // Button places in reference pixels (1440 high) from the frame's centre, measured on a live 16:9 frame.
  var BTN = { confirm: { x: 126, y: 1363, w: 230, h: 52 }, refresh: { x: 329, y: 1363, w: 140, h: 52 } };
  function stepsFor(choice) {
    if (!FRAME || !choice) return null;
    var c = FRAME.crop, ox = c.left || 0, oy = c.top || 0, w = FRAME.w - ox - (c.right || 0), h = FRAME.h - oy - (c.bottom || 0);
    // the hand where the reader found it: a little up or down, and on some screens drawn a few percent larger than the rest
    var ui = FRAME.ui || 1, fit = FRAME.shift || [0, 0], hs = fit[2] || 1, L = V.handLayout ? V.handLayout({ width: w, height: h }, ui, fit) : V.layout({ width: w, height: h }, ui);
    var k = L.hk || L.k, s1 = h / 1440, cx = w / 2;
    var bottom = function (y) { return (1440 - (1440 - y) * ui * hs) * s1; };   // the buttons grow from the bottom edge with the game's interface scale
    var rect = function (x, y, rw, rh, kind, label) { return { kind: kind, label: label, fx: (ox + x - rw / 2) / FRAME.w, fy: (oy + y - rh / 2) / FRAME.h, fw: rw / FRAME.w, fh: rh / FRAME.h }; };
    var pt = function (x, y) { return { fx: (ox + x) / FRAME.w, fy: (oy + y) / FRAME.h }; };
    var btn = function (b, kind, label) { var r = rect(cx + b.x * k, bottom(b.y), b.w * k, b.h * k, kind, label); r.spots = [pt(cx + b.x * k, bottom(b.y)), pt(cx + b.x * k, bottom(b.y) - 8 * k), pt(cx + (b.x - 20) * k, bottom(b.y))]; return r; };
    if (choice.refresh) return [btn(BTN.refresh, 'refresh', 'Refresh')];
    var five = S.phase === 'potion' && S.handSize === 5, one = S.phase !== 'potion' && S.handSize === 1, pos = (five ? L.hand5 : one ? [L.cards[1]] : L.cards)[choice.index];
    if (!pos) return null;
    var dy = V.handLayout ? 0 : fit[1] * k;
    var card = rect(pos.cx, pos.cy + dy, 210 * k, 300 * k, 'card', S.hand[choice.index] || 'Card ' + (choice.index + 1));
    // a card not taken by its middle: its art (higher), then its text (lower), one place per try
    card.spots = [pt(pos.cx, pos.cy + dy), pt(pos.cx, pos.cy + dy - 70 * k), pt(pos.cx, pos.cy + dy + 60 * k)];
    var out = [card];
    // a tank takes a click on its monster, and a small one (a Sage, say) floats high in the glass, above the middle the
    // click helper used to aim at (2026-10-22: two clicks on tank 4 not taken): the upper glass first, then the middle,
    // then the name; the click helper moves on to the next spot when a click wasn't taken
    // the tanks where the reader found their labels (a screen shape the layout wasn't measured on), else the layout's
    var tf = FRAME.tankFix;
    (choice.targets || []).forEach(function (t) {
      var nb = L.nameBand[t], tx = tf ? tf.cx[t] : L.tankCx[t], ny = nb.y + (tf ? tf.dy : 0), r = rect(tx, ny - 170 * s1, 190 * s1, 250 * s1, 'tank', 'Tank ' + (t + 1));
      r.spots = [pt(tx, ny - 240 * s1), pt(tx, ny - 170 * s1), pt(tx, ny + nb.h / 2)];
      out.push(r);
    });
    out.push(btn(BTN.confirm, 'confirm', 'Confirm'));
    return out;
  }
  window.__voraxSteps = stepsFor;
  window.VoraxPage = { instMode: function (m) { if (m) { S.instMode = m; save(); advice(); } return S.instMode; }, speed: function (v) { if (v) { setSpeed(v); advice(); } return SPEED; } };   // for tests and the debug review
  function sendPlan() {
    var D = window.VoraxDesktop; if (!D || !D.plan || !ADV) return;
    var pick = function (c) { return c ? { steps: stepsFor(c), choice: c } : null; };
    D.plan({ id: ADV.id + ':' + (FRAME ? FRAME.id : 0), frame: FRAME ? FRAME.id : null, area: FRAME ? FRAME.area : null, frameAt: FRAME ? FRAME.t : null, live: FRAME ? FRAME.live : false, unsure: FRAME ? FRAME.unsure : 99, hold: FRAME ? FRAME.hold || '' : '', phase: ADV.phase, round: ADV.round,
      instant: pick(ADV.instant), ahead: pick(ADV.ahead), deep: pick(ADV.deep), aheadPending: ADV.aheadPending, deepPending: ADV.deepPending || !!running });
  }

  /* ---------- debug: advice snapshots, the bundle button ---------- */
  var advTimer = 0;
  function rows(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel), 0, 6).map(function (o) { var l = o.querySelector('.lab'), p = o.querySelector('.pct'), sub = o.querySelector('.sub'); return [l ? l.textContent.trim() : '', p ? p.textContent.trim() : '', sub ? sub.textContent.trim().slice(0, 120) : '']; }); }
  function snapAdvice() {
    if (!window.VoraxDebug) return;
    clearTimeout(advTimer);
    advTimer = setTimeout(function () {
      var what = $('rec').querySelector('.what'), why = $('rec').querySelector('.why');
      VoraxDebug.event('advice', { target: target(), board: VoraxDebug.board(S), move: what ? what.textContent : '', why: why ? why.textContent.slice(0, 300) : '', quick: rows('#quickList .opt'), ahead: rows('#ahead .opt'), deep: rows('#deepList .opt') });
    }, 800);
  }
  ['rec', 'ahead', 'deepList'].forEach(function (id) { new MutationObserver(snapAdvice).observe($(id), { childList: true, subtree: true }); });
  function dbgCount() { var e = $('dbgCount'); if (e && window.VoraxDebug) { var c = VoraxDebug.counts(); e.textContent = c.frames + ' picture' + (c.frames === 1 ? '' : 's') + ', ' + c.events + ' events recorded on this PC'; } }
  if ($('dbgSave')) {
    $('dbgSave').onclick = function () { var b = this; b.disabled = true; VoraxDebug.bundle({ target: target(), shareOn: !!(document.getElementById('shareOn') || {}).checked }).then(function (r) { $('dbgCount').textContent = 'Saved: ' + r.frames + ' pictures, ' + r.events + ' events (' + Math.round(r.bytes / 1024) + ' KB). Send me that .zip.'; }).catch(function (e) { $('dbgCount').textContent = 'Could not save: ' + e.message; }).then(function () { b.disabled = false; }); };
    $('dbgClear').onclick = function () { VoraxDebug.clear(); dbgCount(); };
    dbgCount();
  }

  /* ---------- inside the desktop app: follow the game automatically, send the advice to the overlay card ---------- */
  var D = window.VoraxDesktop;
  function txt(id) { var e = $(id); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; }
  var cardTimer = 0;
  function pushCard() {
    if (!D || !D.showAdvice) return;
    clearTimeout(cardTimer);
    cardTimer = setTimeout(function () {
      var what = $('rec').querySelector('.what'), why = $('rec').querySelector('.why');
      var others = Array.prototype.slice.call(document.querySelectorAll('#deepList .opt, #ahead .opt, #quickList .opt'), 0, 12)
        .map(function (o) { var l = o.querySelector('.lab'), p = o.querySelector('.pct'); return l ? l.textContent.replace(/(Best|Ruled out|Look-ahead pick|As good)/g, '').trim() + (p ? ': ' + p.textContent.trim() : '') : ''; })
        .filter(Boolean);
      var seen = {}; others = others.filter(function (o) { var k = o.split(':')[0]; if (seen[k]) return false; seen[k] = 1; return true; }).slice(1, 4);
      var deep = $('deepList').querySelector('.opt');
      var ahead = $('ahead').querySelector('.opt.best .sub');
      var detail = deep ? 'Deep check: ' + deep.querySelector('.pct').textContent + ' to reach ' + fmt(target()) : ahead ? ahead.textContent : (why ? why.textContent : '');
      var checks = Array.prototype.map.call(document.querySelectorAll('#readCheck .warnrow'), function (e) { return e.textContent; }).slice(0, 3);
      D.showAdvice({ move: what ? what.textContent : 'Waiting for the board', detail: detail, others: others, round: S.round, updating: !!running || reading, asks: checks, target: fmt(target()) });
    }, 150);
  }
  if (D) {
    document.documentElement.classList.add('in-app');
    // the overlay card follows every change of advice
    new MutationObserver(pushCard).observe($('rec'), { childList: true, subtree: true });
    ['ahead', 'deepList', 'readCheck'].forEach(function (id) { new MutationObserver(pushCard).observe($(id), { childList: true, subtree: true }); });
    var appTab = document.querySelector('#srcTabs button[data-v=live]');
    if (appTab) { appTab.click(); }
    var gameOn = false;
    // (Vorax Helper) the game window shared, tried again when Windows refuses it (a game still starting up, a capture
    // that fails once: "NotReadableError: Could not start video source"): after 3 s, 10 s, then every 30 s
    var shareTimer = 0;
    appShare = function (attempt, wait) {
      clearTimeout(shareTimer);
      shareTimer = setTimeout(function () {
        if (!live || !gameOn || live.sharing) return;
        live.share().then(function () {
          if (live && live.sharing) { liveErr = ''; if (window.VoraxDebug) VoraxDebug.event('status', { share: 'on', attempt: attempt }); }
          else if (gameOn) appShare(attempt + 1, [3000, 10000, 30000][Math.min(attempt, 2)]);
          renderLive();
        });
      }, wait);
    };
    function startApp() {
      if (V.warmPool) setTimeout(function () { V.warmPool(); }, 500);   // the look-ahead's workers loaded before the first board
      startLive().connectDesktop(); logHandle = { app: true };
      // a picture after every move, from the screen itself (Tartarus's still-screen watch): works with the game's log detail off too
      if (D.settings) D.settings.get().then(function (v) { if (live) live.watchScreen(!v || !v.values || v.values.watchScreen !== false); if (v && v.values) setSpeed(v.values.speed); }); else live.watchScreen(true);
      tracker = V.newTracker();
      appShare(0, 1500);   // the app answers with the game window, no picker; if Windows refuses, the app's own pictures are used meanwhile
      renderLive();
    }
    if (D.onGame) D.onGame(function (g) {
      if (g.running && !gameOn) { gameOn = true; startApp(); }
      else if (!g.running && gameOn) { gameOn = false; if (live) { live.stop(); live = null; } logHandle = null; renderLive(); }
    });
    if (D.onSnap) D.onSnap(function (kind) { startLive().snapNow(kind); });
    if (D.onWatchScreen) D.onWatchScreen(function (on) { if (live) live.watchScreen(on); });
    if (D.onSpeed) D.onSpeed(function (v) { setSpeed(v); advice(); });
    if (D.onDebugFlag) D.onDebugFlag(function () { if (window.VoraxDebug) VoraxDebug.event('flag', { note: 'player pressed the report hotkey', board: VoraxDebug.board(S) }); });
    $('autoDeep').checked = true;
    pushCard();
  }
  boot();
})();
