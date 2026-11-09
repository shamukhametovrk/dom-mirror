// @ts-check
// Позиции прокрутки от сервера (программные прокрутки сайта, колесо над тем, что копия не прокручивает сама)
// приходят неровно, через 20–70 мс. Копия плавно догоняет последнюю позицию на каждом своём кадре.
// Далёкие переходы (якорь, «в начало») применяются сразу.

/** @typedef {{ id: number, x: number, y: number }} ScrollData */
/** @typedef {{ x: number, y: number, tx: number, ty: number }} Motion */
/** @typedef {Window | Element} Scroller */

const TAU_MS = 25;
const SNAP_PX = 0.5;
const JUMP_PX = 2000;

/** @param {number} from @param {number} to @param {number} k */
const approach = (from, to, k) => (Math.abs(to - from) <= SNAP_PX ? to : from + (to - from) * k);

/** @param {Motion} m @param {number} elapsedMs */
export function advance(m, elapsedMs) {
  const k = 1 - Math.exp(-elapsedMs / TAU_MS);
  m.x = approach(m.x, m.tx, k);
  m.y = approach(m.y, m.ty, k);
  return m.x === m.tx && m.y === m.ty;
}

/** @param {Motion} m */
export const isFarJump = (m) => Math.max(Math.abs(m.tx - m.x), Math.abs(m.ty - m.y)) > JUMP_PX;

/** @param {Node} node @returns {Scroller | null} */
const scrollerOf = (node) => (node?.nodeType === Node.DOCUMENT_NODE ? /** @type {Document} */ (node).defaultView : /** @type {Element} */ (node));

/** @param {Scroller} s */
const positionOf = (s) => ("scrollX" in s ? { x: s.scrollX, y: s.scrollY } : { x: s.scrollLeft, y: s.scrollTop });

/** @param {Scroller} s @param {Motion} m */
const place = (s, m) => s.scrollTo({ left: m.x, top: m.y, behavior: "instant" });

/** @param {Map<Scroller, Motion>} motions */
function createFrameLoop(motions) {
  let last = 0;
  const frame = (now) => {
    for (const [scroller, m] of motions) {
      const done = advance(m, now - last);
      place(scroller, m);
      if (done) motions.delete(scroller);
    }
    last = now;
    if (motions.size) requestAnimationFrame(frame);
  };
  return () => {
    last = performance.now();
    requestAnimationFrame(frame);
  };
}

/** @param {any} replayer @param {(scroller: Scroller, data: ScrollData) => boolean} ignores */
export function smoothScrolling(replayer, ignores) {
  /** @type {Map<Scroller, Motion>} */
  const motions = new Map();
  const startLoop = createFrameLoop(motions);
  /** @param {Scroller} scroller @param {ScrollData} data */
  const move = (scroller, data) => {
    const m = Object.assign(motions.get(scroller) ?? positionOf(scroller), { tx: data.x, ty: data.y });
    if (isFarJump(m)) return place(scroller, Object.assign(m, { x: m.tx, y: m.ty }));
    if (!motions.size) startLoop();
    motions.set(scroller, m);
  };
  replayer.applyScroll = (/** @type {ScrollData} */ data) => {
    const scroller = scrollerOf(replayer.getMirror().getNode(data.id));
    if (scroller && !ignores(scroller, data)) move(scroller, data);
  };
  return { move };
}
