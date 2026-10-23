// Copies the helper's pages (../web) into the app, so the app runs them from disk with no website needed.
const fs = require('fs');
const path = require('path');
const from = path.join(__dirname, '..', '..', 'web');
const to = path.join(__dirname, '..', 'web');
fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log('copied the helper pages into the app');
