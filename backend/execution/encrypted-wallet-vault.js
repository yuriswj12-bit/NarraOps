import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { ExecutionError } from "./errors.js";

const FORMAT = "narraops-wallet-vault-v1";
const KEY_BYTES = 32;

function requireText(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ExecutionError("INVALID_WALLET_SECRET", `${field} is required`);
  }
  return value;
}

function deriveKey(password, salt) {
  const secret = Buffer.isBuffer(password) ? password : requireText(password, "password");
  if (!secret.length) throw new ExecutionError("INVALID_WALLET_SECRET", "password is required");
  return scryptSync(secret, salt, KEY_BYTES, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

function encode(buffer) {
  return buffer.toString("base64url");
}

function decode(value) {
  return Buffer.from(value, "base64url");
}

/**
 * Encrypts wallet material at rest. The returned envelope is safe to persist,
 * but the password and decrypted key must remain inside the execution process.
 */
export function sealWalletSecret({ walletReferenceId, publicAddress, privateKey, password }) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const aad = Buffer.from(`${walletReferenceId}:${publicAddress}`, "utf8");
  cipher.setAAD(aad);
  const plaintext = Buffer.from(requireText(privateKey, "privateKey"), "utf8");

  try {
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      format: FORMAT,
      kdf: "scrypt-N32768-r8-p1",
      cipher: "aes-256-gcm",
      walletReferenceId,
      publicAddress,
      salt: encode(salt),
      iv: encode(iv),
      ciphertext: encode(ciphertext),
      authTag: encode(cipher.getAuthTag()),
    };
  } finally {
    plaintext.fill(0);
    key.fill(0);
  }
}

export function openWalletSecret(envelope, password) {
  if (!envelope || envelope.format !== FORMAT) {
    throw new ExecutionError("UNSUPPORTED_WALLET_SECRET", "Unsupported wallet secret envelope");
  }
  const salt = decode(envelope.salt);
  const key = deriveKey(password, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, decode(envelope.iv));
  decipher.setAAD(Buffer.from(`${envelope.walletReferenceId}:${envelope.publicAddress}`, "utf8"));
  decipher.setAuthTag(decode(envelope.authTag));

  try {
    return Buffer.concat([decipher.update(decode(envelope.ciphertext)), decipher.final()]);
  } catch {
    throw new ExecutionError("WALLET_UNLOCK_FAILED", "Wallet password is incorrect or encrypted material is damaged");
  } finally {
    key.fill(0);
  }
}
