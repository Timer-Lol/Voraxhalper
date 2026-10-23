// Draws the advised move's spots over the game, numbered in order.
(function () {
  window.VoraxMark.on(function (m) {
    document.body.textContent = '';
    (m && m.boxes || []).forEach(function (b, i) {
      var el = document.createElement('div');
      el.className = 'box' + (i === m.next ? ' next' : i < m.next ? ' dim' : '');
      el.style.left = Math.round(b.x) + 'px'; el.style.top = Math.round(b.y) + 'px'; el.style.width = Math.round(b.w) + 'px'; el.style.height = Math.round(b.h) + 'px';
      var chip = document.createElement('div'); chip.className = 'chip'; chip.textContent = String(i + 1); el.appendChild(chip);
      if (b.label) { var l = document.createElement('div'); l.className = 'lbl'; l.textContent = b.label; el.appendChild(l); }
      document.body.appendChild(el);
    });
  });
})();
