// @ts-check
// Прикрепление файлов: окно выбора, которое открыл сайт, перетаскивание на страницу и вставка файла из буфера.
// Файлы сначала загружаются на сервер (POST /upload), затем серверный Chrome получает их настоящими путями.
import { MAX_FILES } from "../../shared/protocol.js";

/** @typedef {import("../../shared/protocol.js").ClientMessage} ClientMessage */
/** @typedef {import("../../shared/protocol.js").FileChooser} FileChooser */
/** @typedef {import("./toasts.js").Toast} Toast */
/** @typedef {{ x: number, y: number }} Point */

const HIDE_AFTER_MS = 6000;

/** @param {File} file @returns {Promise<string>} */
async function upload(file) {
  const res = await fetch(`/upload?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).id;
}

/** @param {(t: Toast) => unknown} toast */
const createUploader = (toast) => async (/** @type {File[]} */ files) => {
  const list = files.slice(0, MAX_FILES);
  toast({ key: "upload", text: `Загружается: ${list.map((f) => f.name).join(", ")}` });
  try {
    const ids = await Promise.all(list.map(upload));
    toast({ key: "upload", text: `Прикреплено: ${list.length}`, hideAfterMs: HIDE_AFTER_MS / 3 });
    return ids;
  } catch (e) {
    toast({ key: "upload", text: `Не удалось загрузить: ${e.message}`, kind: "failed", hideAfterMs: HIDE_AFTER_MS });
    return [];
  }
};

// Без недавнего клика браузер не откроет окно выбора: тогда просим нажать на уведомление.
/** @param {HTMLInputElement} input @param {(t: Toast) => unknown} toast */
function openPicker(input, toast) {
  try {
    if (input.showPicker) input.showPicker();
    else input.click();
  } catch {
    toast({ key: "chooser", text: "Нажмите, чтобы выбрать файл", onClick: () => input.click() });
  }
}

/** @param {FileChooser} chooser @param {(files: File[]) => void} onFiles */
function createInput(chooser, onFiles) {
  const input = Object.assign(document.createElement("input"), { type: "file", multiple: chooser.multiple, accept: chooser.accept });
  input.style.cssText = "position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0";
  input.addEventListener("change", () => {
    onFiles([...input.files]);
    input.remove();
  }, { once: true });
  return document.body.appendChild(input);
}

/** @param {DataTransfer | null} data */
const hasFiles = (data) => Boolean(data?.types.includes("Files"));

/**
 * @param {{ stage: HTMLElement, overlay: HTMLElement, send: (msg: ClientMessage) => void, toast: (t: Toast) => unknown,
 *   pastePoint: () => Point }} deps
 */
export function createFileTransfer({ stage, overlay, send, toast, pastePoint }) {
  const uploadAll = createUploader(toast);
  /** @param {File[]} files @param {Point} at */
  const drop = async (files, at) => {
    const ids = await uploadAll(files);
    if (ids.length) send({ type: "drop", x: at.x, y: at.y, files: ids });
  };
  bindDrop(stage, overlay, drop);
  return {
    /** @param {FileChooser} chooser */
    choose: (chooser) => openPicker(createInput(chooser, async (files) => {
      const ids = await uploadAll(files);
      if (ids.length) send({ type: "attach", chooser: chooser.id, files: ids });
    }), toast),
    /** @param {File[]} files */
    paste: (files) => drop(files, pastePoint()),
  };
}

/** @param {HTMLElement} stage @param {HTMLElement} overlay @param {(files: File[], at: Point) => void} drop */
function bindDrop(stage, overlay, drop) {
  const show = (on) => stage.classList.toggle("dragging", on);
  // файл, брошенный мимо страницы, браузер открыл бы вместо копии
  for (const type of ["dragover", "drop"]) window.addEventListener(type, (/** @type {DragEvent} */ e) => hasFiles(e.dataTransfer) && e.preventDefault());
  overlay.addEventListener("dragover", (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    show(true);
  });
  overlay.addEventListener("dragleave", () => show(false));
  overlay.addEventListener("drop", (/** @type {DragEvent} */ e) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    show(false);
    const r = overlay.getBoundingClientRect();
    drop([...e.dataTransfer.files], { x: e.clientX - r.left, y: e.clientY - r.top });
  });
}
