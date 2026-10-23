// Builds web/js/vorax-engine.js (the page) and web/js/vorax-workers.js (the Web Workers, as strings).
import { $ } from 'bun'
import { readFileSync, writeFileSync } from 'node:fs'
const out = 'web/js'
for (const [entry, file] of [['src/web/scanWorker.ts', 'scan.tmp.js'], ['src/web/liveWorker.ts', 'live.tmp.js'], ['src/web/futuresWorker.ts', 'futures.tmp.js']])
  await $`bun build ${entry} --target browser --format iife --minify --outfile ${out}/${file}`.quiet()
const w = { scan: readFileSync(`${out}/scan.tmp.js`, 'utf8'), live: readFileSync(`${out}/live.tmp.js`, 'utf8'), futures: readFileSync(`${out}/futures.tmp.js`, 'utf8') }
writeFileSync(`${out}/vorax-workers.js`, 'window.VORAX_WORKERS=' + JSON.stringify(w) + ';')
await $`rm ${out}/scan.tmp.js ${out}/live.tmp.js ${out}/futures.tmp.js`
await $`bun build src/web/entry.ts --target browser --format iife --minify --outfile ${out}/vorax-engine.js`.quiet()
console.log('built', ['vorax-engine.js', 'vorax-workers.js'].map(f => f + ' ' + Math.round(readFileSync(`${out}/${f}`).length / 1024) + ' KB').join(', '))
