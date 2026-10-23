// Shares one game window (never a whole screen or a tab) and grabs single frames of it on request.

export interface WindowShare {
  grab(): Promise<ImageData>
  /** (Vorax Helper) a tiny picture, for watching the screen for a move */
  probe?(): Promise<ImageData>
  stop(): void
  onEnded(fn: () => void): void
  readonly size: { width: number; height: number }
}

export class NotAWindowError extends Error {
  constructor() {
    super('Share the game window, not a whole screen or a browser tab.')
  }
}

function canvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function pixels(source: CanvasImageSource, w: number, h: number): ImageData {
  const ctx = canvas(w, h).getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
  ctx.drawImage(source, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

/** A PNG (or JPEG) of a frame, for saving or downloading. */
export async function toPng(img: ImageData, type = 'image/png', quality?: number): Promise<Blob> {
  const c = canvas(img.width, img.height)
  ;(c.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D).putImageData(img, 0, 0)
  if ('convertToBlob' in c) return c.convertToBlob({ type, quality })
  return new Promise((resolve, reject) => c.toBlob(b => (b ? resolve(b) : reject(new Error('Image failed'))), type, quality))
}

export async function shareWindow(md: MediaDevices = navigator.mediaDevices): Promise<WindowShare> {
  const stream = await md.getDisplayMedia({ video: { displaySurface: 'window', frameRate: 30 }, audio: false } as DisplayMediaStreamOptions)
  const track = stream.getVideoTracks()[0]
  const settings = track.getSettings() as MediaTrackSettings & { displaySurface?: string }
  if (settings.displaySurface !== 'window') {
    stream.getTracks().forEach(t => t.stop())
    throw new NotAWindowError()
  }
  const ended: (() => void)[] = []
  track.addEventListener('ended', () => ended.forEach(f => f()))

  // (Vorax Helper) frames are taken from a playing video of the share, not ImageCapture.grabFrame(): grabFrame waits
  // for the window's next frame and, asked twice at once (the screen watch and a log trigger), rejects with nothing
  // at all ("undefined" in the reports of 2026-10-22, each one a board read seconds late); a video always has the
  // latest frame ready
  let video: HTMLVideoElement | null = null
  let ready: Promise<HTMLVideoElement> | null = null
  const playing = () =>
    (ready ??= (async () => {
      const v = document.createElement('video')
      v.muted = true
      v.playsInline = true
      v.srcObject = stream
      await v.play()
      // the first frame's size is known a moment after play starts
      for (let i = 0; i < 40 && !v.videoWidth; i++) await new Promise(r => setTimeout(r, 25))
      video = v
      return v
    })().catch(err => { ready = null; throw err }))
  const live = async () => {
    const v = video ?? (await playing())
    // a window hidden or minimized can pause the video: it plays on, so the frames stay current
    if (v.paused) await v.play().catch(() => {})
    return v
  }
  const grab = async (): Promise<ImageData> => {
    const v = await live()
    return pixels(v, v.videoWidth, v.videoHeight)
  }
  const probe = async (): Promise<ImageData> => {
    const v = await live()
    return pixels(v, 192, Math.max(1, Math.round((v.videoHeight * 192) / Math.max(1, v.videoWidth))))
  }
  void playing().catch(() => {})
  return {
    grab,
    probe,
    stop: () => { stream.getTracks().forEach(t => t.stop()); if (video) video.srcObject = null },
    onEnded: fn => void ended.push(fn),
    get size() {
      const s = track.getSettings()
      return { width: s.width ?? 0, height: s.height ?? 0 }
    },
  }
}
