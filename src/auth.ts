// Autenticacion simple por contrasena compartida + cookie firmada (HMAC-SHA256).
// No requiere librerias externas: usa Web Crypto, disponible en Cloudflare Workers.

function bufToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBuf(s: string): ArrayBuffer {
  const normalized = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function strToBase64Url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToStr(s: string): string {
  const normalized = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 dias

export async function createSessionToken(
  secret: string,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<string> {
  const payload = JSON.stringify({ exp: Date.now() + ttlMs });
  const payloadB64 = strToBase64Url(payload);
  const key = await getHmacKey(secret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64)
  );
  return `${payloadB64}.${bufToBase64Url(sig)}`;
}

export async function verifySessionToken(
  token: string | undefined | null,
  secret: string
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, sigB64] = parts;
  try {
    const key = await getHmacKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBuf(sigB64),
      new TextEncoder().encode(payloadB64)
    );
    if (!valid) return false;
    const payload = JSON.parse(base64UrlToStr(payloadB64));
    return typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}
