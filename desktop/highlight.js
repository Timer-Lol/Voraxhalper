'use strict';
// The highlight over the game: which spots of the advised move to box (the card, its target tanks, Confirm or
// Refresh), from the helper page's newest plan. It only draws; nothing here touches the mouse or the game.

const MAX_AGE = 45000;

function createHighlighter(io) {
  // io: { settings, now() }
  let plan = null;
  const S = () => io.settings;

  /** The choice to show, by the "advice to follow" setting; null while it is still being worked out. */
  function choice(p) {
    if (!p) return { why: 'no advice yet' };
    const want = S().adviceSource || 'ahead';
    if (p.phase !== 'potion') return p.instant ? { pick: p.instant } : { why: p.aheadPending ? 'waiting for the board look-ahead' : 'no advice for this pick' };
    if (want === 'deep') {
      if (p.deep) return { pick: p.deep };
      if (p.deepPending) return { why: 'waiting for the deep check' };
    }
    if (want !== 'instant') {
      if (p.ahead) return { pick: p.ahead };
      if (p.aheadPending) return { why: 'waiting for the look-ahead' };
    }
    return p.instant ? { pick: p.instant } : { why: 'no advice yet' };
  }
  /** From this round on the player plays on their own: no highlight (0: never). */
  const handedOver = (p) => { const from = Number(S().hideFromRound ?? 11); return !!from && !!p && Number(p.round) >= from; };

  return {
    setPlan(p) { plan = p; },
    /** what the highlight should show: the spots of the advice */
    marks() {
      const p = plan;
      if (!p || (p.frameAt && io.now() - p.frameAt > MAX_AGE) || handedOver(p)) return null;
      let c = choice(p), final = true;
      // still being worked out: show the instant answer meanwhile, marked as not final
      if (!c.pick && p.instant) { c = { pick: p.instant }; final = false; }
      if (!c.pick || !c.pick.steps) return null;
      return { id: p.id, steps: c.pick.steps, next: 0, final };
    },
    choice: () => choice(plan),
  };
}

module.exports = { createHighlighter, MAX_AGE };
