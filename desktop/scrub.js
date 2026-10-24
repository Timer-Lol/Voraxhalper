// (Vorax Helper) The scrubber for debug reports: what leaves the PC is only about the Vorax board and the helper.
// The report never holds game-log text (the helper reads UE_game.log but keeps none of its lines: only "the board
// changed" moments). What it does hold is the helper's own record: pictures of the game window, what it read and
// advised, the fixes made, the app's own log and settings. The texts among those can still carry a Windows user
// name (in a path like C:\Users\<name>\...), a machine name or an address, so every text file in a report goes
// through scrubText() before it is zipped.
'use strict';

const RULES = [
  // Windows and Unix home folders, also inside JSON (where \ is written \\): C:\Users\Alice Smith\AppData →
  // C:\Users\<user>\AppData; /home/alice/ → /home/<user>/
  [/((?:^|[\\/])Users(?:\\\\|[\\/]))([^\\/"'<>|]+?)(?=\\\\|[\\/])/gi, '$1<user>'],
  [/(\/home\/)[^/"'\s]+/g, '$1<user>'],
  // IPv4 addresses and e-mail addresses
  [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/g, '<ip>'],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>'],
  // the machine's name at the start of a UNC path (\\PC\share)
  [/(^|[\s"'(=])\\\\(\\\\)?([A-Za-z0-9._-]+)(?=\\)/g, '$1\\\\$2<pc>'],
];
const env = () => [process.env.USERNAME, process.env.USER, process.env.COMPUTERNAME, require('os').hostname()].filter((v) => v && v.length > 2);

/** Text with user names, machine names and addresses blanked. */
function scrubText(text) {
  let t = String(text);
  for (const [re, to] of RULES) t = t.replace(re, to);
  // the user's and machine's names wherever else they appear (whole words, any case)
  for (const n of env()) t = t.replace(new RegExp(`(?<![\\w-])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'gi'), n === process.env.COMPUTERNAME || n === require('os').hostname() ? '<pc>' : '<user>');
  return t;
}

/** The file list of a report, each text entry scrubbed (pictures pass through). */
function scrubFiles(files) {
  return files.map((f) => (/\.(json|jsonl|txt|log|csv|md)$/i.test(f.name) ? { ...f, data: scrubText(Buffer.isBuffer(f.data) ? f.data.toString('utf8') : f.data) } : f));
}

module.exports = { scrubText, scrubFiles, RULES };
