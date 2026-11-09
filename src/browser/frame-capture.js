// @ts-check
// Картинки cross-origin iframe. Снимки идут через ту же очередь, что и ввод: параллельно с ними Chrome терял клики.
import crypto from "node:crypto";
import { repeat, sleep } from "../util/async.js";

/** @typedef {import("../../shared/protocol.js").FrameRect} FrameRect */
/** @typedef {import("../../shared/protocol.js").FrameUpdate} FrameUpdate */
/** @typedef {FrameRect & { sx: number, sy: number }} ScrolledRect */
/** @typedef {FrameRect & { img?: string, hash?: string }} FrameState */

const MAX_FRAMES = 6;
const TICK_MS = 250;
const INPUT_QUIET_MS = 300;

/** @param {FrameRect} r @returns {FrameRect} */
const geometry = ({ id, x, y, w, h }) => ({ id, x, y, w, h });

/** @param {FrameState | undefined} prev @param {FrameRect} rect */
const moved = (prev, rect) => !prev || ["x", "y", "w", "h"].some((k) => prev[k] !== rect[k]);

/** @param {FrameState | undefined} prev @param {Buffer | null} shot */
function freshImage(prev, shot) {
  if (!shot) return null;
  const hash = crypto.createHash("md5").update(shot).digest("hex");
  return hash === prev?.hash ? null : { hash, img: shot.toString("base64") };
}

/** @param {FrameState | undefined} prev */
const previousImage = (prev) => ({ hash: prev?.hash, img: prev?.img });

/** @param {FrameState | undefined} prev @param {FrameRect} rect @param {Buffer | null} shot */
export function diffFrame(prev, rect, shot) {
  const fresh = freshImage(prev, shot);
  const image = fresh ?? previousImage(prev);
  return {
    state: { ...geometry(rect), ...image },
    update: { ...geometry(rect), img: fresh?.img },
    changed: Boolean(fresh) || moved(prev, rect),
  };
}

/** @typedef {<T>(task: () => Promise<T>) => Promise<T>} Serial */

// fromSurface: иначе Chrome на время снимка меняет окно. Сразу после снимка Chrome может потерять
// событие мыши, поэтому пауза — внутри той же очереди, что и ввод.
/** @param {{ session: import("../cdp/session.js").CdpSession, serial: Serial, settleMs: number }} deps */
const createShooter = ({ session, serial, settleMs }) => (/** @type {ScrolledRect} */ r) => serial(async () => {
  const clip = { x: r.x + r.sx, y: r.y + r.sy, width: r.w, height: r.h, scale: 1 };
  const shot = await session.send("Page.captureScreenshot", {
    format: "jpeg", quality: 70, captureBeyondViewport: false, fromSurface: true, clip,
  });
  await sleep(settleMs);
  return Buffer.from(shot.data, "base64");
}).catch(() => null);

/**
 * @param {{
 *   session: import("../cdp/session.js").CdpSession,
 *   serial: Serial,
 *   activity: import("../util/async.js").Activity,
 *   settleMs: number,
 * }} deps
 */
export function createFrameCapture({ session, serial, activity, settleMs }) {
  /** @type {ScrolledRect[]} */
  let rects = [];
  /** @type {Map<number, FrameState>} */
  let states = new Map();
  const shoot = createShooter({ session, serial, settleMs });

  /** @returns {Promise<FrameUpdate[] | null>} */
  async function capture() {
    if (activity.idleFor() < INPUT_QUIET_MS) return null;
    const results = [];
    for (const rect of rects) results.push(diffFrame(states.get(rect.id), rect, await shoot(rect)));
    const dirty = rects.length !== states.size || results.some((r) => r.changed);
    states = new Map(results.map((r) => [r.state.id, r.state]));
    return dirty ? results.map((r) => r.update) : null;
  }

  return {
    capture,
    hasFrames: () => rects.length > 0 || states.size > 0,
    /** @param {ScrolledRect[]} list */
    setRects: (list) => { rects = list.slice(0, MAX_FRAMES); },
    clearRects: () => { rects = []; },
    /** @returns {FrameUpdate[]} */
    snapshot: () => [...states.values()].map(({ hash: _hash, ...frame }) => frame),
  };
}

/** @typedef {ReturnType<typeof createFrameCapture>} FrameCapture */

/** @param {FrameCapture} frames @param {() => boolean} isWatched @param {(frames: FrameUpdate[]) => void} publish */
export function startFrameCapture(frames, isWatched, publish) {
  repeat("frames", TICK_MS, async () => {
    if (!isWatched() || !frames.hasFrames()) return;
    const updates = await frames.capture();
    if (updates) publish(updates);
  });
}
