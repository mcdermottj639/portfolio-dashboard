// Writes ../data.json. If PF_PASSPHRASE is set in the environment, the payload is
// AES-GCM encrypted (key derived from the passphrase via PBKDF2) into a small envelope;
// otherwise it's written as plaintext (handy for local dev with the fake sample).
// The PWA shim in index.html decrypts with the identical scheme — keep them in sync.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const subtle = globalThis.crypto.subtle;
const ITER = 150000;
const b64 = (u8) => Buffer.from(u8).toString('base64');
const b64d = (s) => new Uint8Array(Buffer.from(s, 'base64'));

async function deriveKey(pass, salt, usage) {
  const km = await subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, usage);
}

export async function encryptEnvelope(plaintext, pass) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt, ['encrypt']);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return { enc: 1, v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

export async function decryptEnvelope(env, pass) {
  const key = await deriveKey(pass, b64d(env.salt), ['decrypt']);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: b64d(env.iv) }, key, b64d(env.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

export async function emit(dataObj) {
  const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'data.json');
  const pass = process.env.PF_PASSPHRASE;
  const plaintext = JSON.stringify(dataObj);
  if (pass) {
    writeFileSync(out, JSON.stringify(await encryptEnvelope(plaintext, pass)));
    console.log('emitted ENCRYPTED data.json (' + plaintext.length + ' bytes plaintext → locked)');
  } else {
    writeFileSync(out, plaintext);
    console.log('emitted PLAINTEXT data.json (no PF_PASSPHRASE set — dev mode)');
  }
}
