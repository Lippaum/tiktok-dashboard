export function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

export function fold(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

export function redact(text, token) {
  const raw = String(text ?? "");
  if (!token) return raw;
  return raw.split(token).join("[REDACTED]");
}

export function readPath(raw, path) {
  if (!raw || typeof raw !== "object") return undefined;
  const dotted = path.join(".");
  if (Object.prototype.hasOwnProperty.call(raw, dotted) && raw[dotted] != null) {
    return raw[dotted];
  }
  let current = raw;
  for (const key of path) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current;
}

export function firstDefined(values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

export function sampleKeys(item) {
  if (!item || typeof item !== "object") return "(vazio)";
  return Object.keys(item).slice(0, 25).join(", ") || "(sem chaves)";
}
