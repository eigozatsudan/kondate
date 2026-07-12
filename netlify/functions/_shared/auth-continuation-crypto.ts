import { webcrypto } from "node:crypto";

const encoder = new TextEncoder();
const cryptoApi = webcrypto;

export type EncryptedContinuationCode = { ciphertext: Uint8Array; iv: Uint8Array };

function additionalData(continuationId: string, origin: string): Uint8Array {
  return encoder.encode(`${continuationId}\n${origin}`);
}

async function importKey(key: Uint8Array): Promise<webcrypto.CryptoKey> {
  return cryptoApi.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await cryptoApi.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function encryptContinuationCode(
  code: string,
  continuationId: string,
  origin: string,
  key: Uint8Array,
): Promise<EncryptedContinuationCode> {
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(continuationId, origin) },
    await importKey(key),
    encoder.encode(code),
  );
  return { ciphertext: new Uint8Array(ciphertext), iv };
}

export async function decryptContinuationCode(
  encrypted: EncryptedContinuationCode,
  continuationId: string,
  origin: string,
  key: Uint8Array,
): Promise<string> {
  try {
    const plaintext = await cryptoApi.subtle.decrypt(
      { name: "AES-GCM", iv: encrypted.iv, additionalData: additionalData(continuationId, origin) },
      await importKey(key),
      encrypted.ciphertext,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error("continuation_decryption_failed");
  }
}
