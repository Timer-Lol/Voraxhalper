// The card from the helper page, cleaned before it crosses into the overlay: plain text only, cut to length.
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
function cleanCard(card) {
  if (!card || typeof card !== 'object') return null;
  return {
    move: text(card.move, 200),
    detail: text(card.detail, 300),
    others: Array.isArray(card.others) ? card.others.slice(0, 3).map((o) => text(o, 200)) : [],
    round: Number.isFinite(card.round) ? card.round : null,
    updating: !!card.updating,
    asks: Array.isArray(card.asks) ? card.asks.filter((a) => typeof a === 'string' && a).slice(0, 3).map((a) => text(a, 200)) : [],
    target: text(card.target, 20),
  };
}
module.exports = { cleanCard };
