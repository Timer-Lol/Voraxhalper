// Cards a player named with "What is this?", kept in this browser so they're recognised next time.
import type { ArtFeature } from './pixels'
import type { LocalRefs } from './scan'

const DB = 'vorax-solver'
const STORE = 'refs'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function loadLocalRefs(): Promise<LocalRefs> {
  try {
    const db = await open()
    return await new Promise<LocalRefs>(resolve => {
      const out: LocalRefs = {}
      const req = db.transaction(STORE).objectStore(STORE).openCursor()
      req.onsuccess = () => {
        const c = req.result
        if (!c) return resolve(out)
        out[String(c.key)] = c.value as ArtFeature[]
        c.continue()
      }
      req.onerror = () => resolve({})
    })
  } catch {
    return {}
  }
}

export async function addLocalRef(key: string, f: ArtFeature): Promise<void> {
  try {
    const db = await open()
    const have = (await loadLocalRefs())[key] ?? []
    await new Promise<void>(resolve => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put([...have, f].slice(-8), key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    // not kept: the card just isn't remembered
  }
}

/** The named cards as a JSON file, for adding them to the built-in data. */
export async function exportLocalRefs(): Promise<Blob> {
  return new Blob([JSON.stringify(await loadLocalRefs())], { type: 'application/json' })
}

/** Forgets every card named in this browser (a wrong name would keep being read). */
export async function forgetLocalRefs(): Promise<void> {
  try {
    const db = await open()
    await new Promise<void>(resolve => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    // nothing stored, or storage blocked
  }
}
