import { ahead, cancelAhead, instrumentValue, warmPool, catalog, check, futuresFor, instrumentAdvice, instrumentAhead, plan, poolSize, quick, TABLES } from './helper'
import { ultimateActivity } from '@/engine/game'
import { handLayout, layout } from '../reader/scan/layout'
import { createScanner, createLive, imageData, newTracker, ocrEngine, trackInstruments } from './reader'
;(globalThis as unknown as { Vorax: unknown }).Vorax = { catalog, plan, instrumentAhead, ahead, cancelAhead, poolSize, futuresFor, check, instrumentAdvice, instrumentValue, warmPool, quick, TABLES, ultimateActivity, createScanner, createLive, imageData, newTracker, trackInstruments, layout, handLayout, ocrEngine }
