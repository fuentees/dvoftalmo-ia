import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO   = "aes-256-gcm";
const PREFIX = "enc:v1:";

function getKey(): Buffer | null {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) return null;
  const buf = Buffer.from(k, "base64");
  return buf.length === 32 ? buf : null;
}

export function encryptValue(plain: string): string {
  const key = getKey();
  if (!key || !plain) return plain;
  const iv  = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptValue(value: string): string {
  if (!value.startsWith(PREFIX)) return value;
  const key = getKey();
  if (!key) return value;
  try {
    const buf = Buffer.from(value.slice(PREFIX.length), "base64");
    const iv  = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const dc  = createDecipheriv(ALGO, key, iv);
    dc.setAuthTag(tag);
    return Buffer.concat([dc.update(enc), dc.final()]).toString("utf8");
  } catch {
    return value;
  }
}

export function isApiKey(key: string): boolean {
  return key.endsWith("_api_key");
}
