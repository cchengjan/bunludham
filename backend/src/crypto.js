/**
 * Cryptographic primitives built on Web Crypto API (crypto.subtle).
 * Works identically on Cloudflare Workers and Node.js >= 22.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const ALPHANUMERIC_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ALPHANUMERIC_LEN = ALPHANUMERIC_CHARS.length; // 62
const REJECTION_LIMIT = 256 - (256 % ALPHANUMERIC_LEN); // 248 — eliminates modulo bias

export function uint8ArrayToBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToUint8Array(base64Url) {
  if (typeof base64Url !== 'string' || !/^[A-Za-z0-9_-]+$/.test(base64Url)) {
    throw new Error('INVALID_BASE64URL');
  }
  const paddedLength = base64Url.length + ((4 - (base64Url.length % 4)) % 4);
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/').padEnd(paddedLength, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function uint8ArrayToHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Generates an unbiased cryptographically random alphanumeric string (A-Za-z0-9).
 * Complies with LINE Login Security Checklist for OAuth `state`.
 */
export function randomAlphanumeric(length = 43) {
  if (!Number.isInteger(length) || length < 16 || length > 256) {
    throw new Error('INVALID_RANDOM_LENGTH');
  }
  let out = '';
  const buf = new Uint8Array(length * 2);
  while (out.length < length) {
    globalThis.crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < length; i++) {
      const byte = buf[i];
      if (byte < REJECTION_LIMIT) {
        out += ALPHANUMERIC_CHARS[byte % ALPHANUMERIC_LEN];
      }
    }
  }
  return out;
}

/**
 * Generates a cryptographically random base64url token (32 bytes = 43 chars).
 */
export function randomBase64Url(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return uint8ArrayToBase64Url(bytes);
}

/**
 * Generates an internal prefixed entity ID (e.g. mem_..., ses_..., aud_...).
 */
export function generateEntityId(prefix) {
  return `${prefix}_${randomAlphanumeric(24)}`;
}

export async function sha256Hex(input) {
  const data = encoder.encode(String(input));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return uint8ArrayToHex(new Uint8Array(digest));
}

/**
 * Computes RFC 7636 PKCE S256 code_challenge = BASE64URL(SHA256(ASCII(code_verifier))).
 */
export async function sha256Base64Url(input) {
  const data = encoder.encode(String(input));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return uint8ArrayToBase64Url(new Uint8Array(digest));
}

export async function hmacSha256Hex(secret, message) {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(String(message)));
  return uint8ArrayToHex(new Uint8Array(sig));
}

/**
 * Derives a session-bound CSRF token using HMAC-SHA256.
 * Never exposes the raw session token or session secret.
 */
export async function deriveCsrfToken(sessionSecret, sessionId, sessionTokenHash) {
  return hmacSha256Hex(sessionSecret, `pfs_csrf_v1:${sessionId}:${sessionTokenHash}`);
}

/**
 * Privacy-preserving hash of client IP address so raw IPs are never stored in DB.
 */
export async function hashClientIp(sessionSecret, rawIp) {
  if (!rawIp) return null;
  const keyMaterial = sessionSecret && sessionSecret.length >= 16 ? sessionSecret : 'pfs_default_ip_salt';
  const full = await hmacSha256Hex(keyMaterial, `pfs_ip_v1:${rawIp}`);
  return full.slice(0, 32);
}

/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 */
export function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bytesA = encoder.encode(a);
  const bytesB = encoder.encode(b);
  const maxLen = Math.max(bytesA.length, bytesB.length);
  let diff = bytesA.length ^ bytesB.length;
  for (let i = 0; i < maxLen; i++) {
    const byteA = i < bytesA.length ? bytesA[i] : 0;
    const byteB = i < bytesB.length ? bytesB[i] : 0;
    diff |= byteA ^ byteB;
  }
  return diff === 0;
}

/**
 * Verifies a JWT signature (HS256 or ES256) and returns `{ header, payload }`.
 * Explicitly rejects `alg: "none"` or any unapproved algorithm.
 */
export async function verifyJwtSignatureAndDecode(jwt, {
  allowedAlgs = ['HS256', 'ES256'],
  channelSecret = '',
  getJwkByKid = null
} = {}) {
  if (typeof jwt !== 'string') {
    throw new Error('JWT_MISSING');
  }
  const parts = jwt.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error('JWT_MALFORMED');
  }

  const [headerB64, payloadB64, sigB64] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(decoder.decode(base64UrlToUint8Array(headerB64)));
    payload = JSON.parse(decoder.decode(base64UrlToUint8Array(payloadB64)));
  } catch (_) {
    throw new Error('JWT_DECODE_ERROR');
  }

  if (!header || typeof header !== 'object' || typeof header.alg !== 'string') {
    throw new Error('JWT_HEADER_INVALID');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('JWT_PAYLOAD_INVALID');
  }

  if (header.alg.toLowerCase() === 'none' || !allowedAlgs.includes(header.alg)) {
    throw new Error(`JWT_ALG_NOT_ALLOWED:${header.alg}`);
  }

  const signingInput = encoder.encode(`${headerB64}.${payloadB64}`);
  const signatureBytes = base64UrlToUint8Array(sigB64);

  if (header.alg === 'HS256') {
    if (!channelSecret) {
      throw new Error('JWT_HS256_SECRET_MISSING');
    }
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      encoder.encode(channelSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const valid = await globalThis.crypto.subtle.verify('HMAC', key, signatureBytes, signingInput);
    if (!valid) {
      throw new Error('JWT_SIGNATURE_INVALID');
    }
    return { header, payload };
  }

  if (header.alg === 'ES256') {
    if (!header.kid || typeof header.kid !== 'string') {
      throw new Error('JWT_KID_MISSING');
    }
    if (typeof getJwkByKid !== 'function') {
      throw new Error('JWT_JWKS_RESOLVER_MISSING');
    }
    const jwk = await getJwkByKid(header.kid);
    if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256') {
      throw new Error('JWT_JWK_NOT_FOUND_OR_UNSUPPORTED');
    }
    if (signatureBytes.length !== 64) {
      throw new Error('JWT_ES256_SIGNATURE_LENGTH_INVALID');
    }
    const publicKey = await globalThis.crypto.subtle.importKey(
      'jwk',
      {
        kty: 'EC',
        crv: 'P-256',
        x: jwk.x,
        y: jwk.y,
        ext: true
      },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const valid = await globalThis.crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      signatureBytes,
      signingInput
    );
    if (!valid) {
      throw new Error('JWT_SIGNATURE_INVALID');
    }
    return { header, payload };
  }

  throw new Error(`JWT_ALG_UNHANDLED:${header.alg}`);
}
