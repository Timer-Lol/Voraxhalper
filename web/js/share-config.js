// The board collector built into this copy of the helper. Sharing is on by default (players see a one-time
// notice and can turn it off in "Share boards"). key is the SENDING key (the worker's KEY secret): it can only
// add boards, never download them. Your EXPORT_KEY must never be in this file.
window.VORAX_SHARE = {
  url: 'https://vorax-collector.timerlol.workers.dev',
  key: 'send-51f66d6a4fba97ebd88f14d4',
  onByDefault: true,
};
