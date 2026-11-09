// @ts-check
// Картинки iframe с чужих сайтов: rrweb их содержимое не передаёт. Клики по ним идут через overlay.

/** @typedef {import("../../shared/protocol.js").FrameUpdate} FrameUpdate */

/** @param {HTMLElement} container */
function createImage(container) {
  const img = new Image();
  img.draggable = false;
  img.onload = () => { img.style.visibility = "visible"; };
  container.appendChild(img);
  return img;
}

/** @param {HTMLImageElement} img @param {FrameUpdate} frame */
function place(img, frame) {
  Object.assign(img.style, { left: `${frame.x}px`, top: `${frame.y}px`, width: `${frame.w}px`, height: `${frame.h}px` });
  if (frame.img) img.src = `data:image/jpeg;base64,${frame.img}`;
}

/** @param {HTMLElement} container @returns {(frames: FrameUpdate[]) => void} */
export function createFrameLayer(container) {
  /** @type {Map<number, HTMLImageElement>} */
  const images = new Map();
  const imageFor = (id) => images.get(id) ?? images.set(id, createImage(container)).get(id);
  const removeMissing = (ids) => {
    for (const [id, img] of images) if (!ids.has(id)) img.remove();
    for (const id of [...images.keys()]) if (!ids.has(id)) images.delete(id);
  };
  return (frames) => {
    for (const frame of frames) place(imageFor(frame.id), frame);
    removeMissing(new Set(frames.map((f) => f.id)));
  };
}
