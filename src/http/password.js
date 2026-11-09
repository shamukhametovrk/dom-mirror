// @ts-check
// Пароль из PASSWORD, иначе из файла в томе данных; если файла нет — генерируется один раз.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** @param {string} file */
function readPasswordFile(file) {
  try {
    return fs.readFileSync(file, "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** @param {string} file @param {string} password */
function savePasswordFile(file, password) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${password}\n`, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/** @param {string} file */
function generatePassword(file) {
  const password = crypto.randomBytes(12).toString("base64url");
  const where = savePasswordFile(file, password) ? `сохранён в ${file}` : "не удалось сохранить, после перезапуска будет новый";
  console.log(`\n  Пароль для входа: ${password}\n  (${where}; свой пароль можно задать переменной PASSWORD)\n`);
  return password;
}

/** @param {{ password: string, passwordFile: string }} config */
export function resolvePassword({ password, passwordFile }) {
  if (password) return password;
  const saved = readPasswordFile(passwordFile);
  if (saved) console.log(`Пароль для входа — в ${passwordFile}`);
  return saved ?? generatePassword(passwordFile);
}
