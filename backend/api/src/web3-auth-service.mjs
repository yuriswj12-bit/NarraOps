import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getAddress, verifyMessage } from "ethers";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { ApiError } from "./errors.mjs";

const CHALLENGE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieValue(header, name) {
  for (const item of String(header || "").split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return null;
}

function normalizeIdentity(chain, address) {
  if (chain === "evm") return getAddress(address);
  if (chain === "solana") {
    const bytes = bs58.decode(String(address));
    if (bytes.length !== 32) throw new Error("invalid Solana address");
    return bs58.encode(bytes);
  }
  throw new Error("unsupported chain");
}

export class Web3AuthService {
  constructor({ filePath, origin = "http://127.0.0.1:5188", now = () => Date.now() } = {}) {
    this.filePath = filePath;
    this.origin = origin;
    this.now = now;
    this.challenges = new Map();
    this.store = this.#load();
  }

  createChallenge({ chain, address, chainId }) {
    let normalized;
    try { normalized = normalizeIdentity(chain, address); } catch { throw new ApiError(400, "INVALID_WALLET_ADDRESS", "Wallet address is invalid for the selected chain"); }
    if (chain === "evm" && (!Number.isInteger(chainId) || chainId <= 0)) throw new ApiError(400, "INVALID_CHAIN_ID", "A positive EVM chainId is required");
    const challengeId = randomUUID();
    const nonce = randomBytes(16).toString("hex");
    const issuedAt = new Date(this.now()).toISOString();
    const expiresAt = new Date(this.now() + CHALLENGE_TTL_MS).toISOString();
    const host = new URL(this.origin).host;
    const message = chain === "evm"
      ? `${host} wants you to sign in with your Ethereum account:\n${normalized}\n\nSign in to NarraOps.\n\nURI: ${this.origin}\nVersion: 1\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${expiresAt}`
      : `${host} wants you to sign in with your Solana account:\n${normalized}\n\nSign in to NarraOps.\n\nURI: ${this.origin}\nVersion: 1\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${expiresAt}`;
    this.challenges.set(challengeId, { challengeId, chain, chainId: chainId || null, address: normalized, message, expiresAt, used: false });
    return { challengeId, chain, address: normalized, message, expiresAt };
  }

  verify({ challengeId, signature }) {
    const challenge = this.#verifyChallenge({ challengeId, signature });
    const identityKey = `${challenge.chain}:${challenge.address.toLowerCase()}`;
    let user = this.store.users.find((item) => item.identities.some((identity) => `${identity.chain}:${identity.address.toLowerCase()}` === identityKey));
    const now = new Date(this.now()).toISOString();
    if (!user) {
      user = { userId: randomUUID(), identities: [{ chain: challenge.chain, address: challenge.address, createdAt: now }], primaryIdentity: identityKey, onboardingCompleted: false, createdAt: now, updatedAt: now };
      this.store.users.push(user);
    }
    const token = randomBytes(32).toString("base64url");
    const session = { sessionId: randomUUID(), tokenHash: sha256(token), userId: user.userId, expiresAt: new Date(this.now() + SESSION_TTL_MS).toISOString(), createdAt: now };
    this.store.sessions = this.store.sessions.filter(({ expiresAt }) => Date.parse(expiresAt) > this.now());
    this.store.sessions.push(session);
    this.#save();
    return { token, maxAge: Math.floor(SESSION_TTL_MS / 1000), session: this.publicSession(user, session) };
  }

  linkIdentity(cookieHeader, { challengeId, signature }) {
    const authenticated = this.authenticate(cookieHeader);
    if (!authenticated) throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Sign in before linking another wallet address");
    const challenge = this.#verifyChallenge({ challengeId, signature });
    const identityKey = `${challenge.chain}:${challenge.address.toLowerCase()}`;
    const owner = this.store.users.find((item) => item.identities.some((identity) => `${identity.chain}:${identity.address.toLowerCase()}` === identityKey));
    if (owner && owner.userId !== authenticated.user.userId) throw new ApiError(409, "WALLET_IDENTITY_ALREADY_LINKED", "This wallet address belongs to another account");
    const user = this.store.users.find(({ userId }) => userId === authenticated.user.userId);
    if (!owner) {
      const now = new Date(this.now()).toISOString();
      user.identities.push({ chain: challenge.chain, address: challenge.address, createdAt: now });
      user.updatedAt = now;
      this.#save();
    }
    return this.authenticate(cookieHeader);
  }

  authenticate(cookieHeader) {
    const token = cookieValue(cookieHeader, "narraops_session");
    if (!token) return null;
    const tokenHash = sha256(token);
    const session = this.store.sessions.find((item) => safeEqual(item.tokenHash, tokenHash) && Date.parse(item.expiresAt) > this.now());
    if (!session) return null;
    const user = this.store.users.find(({ userId }) => userId === session.userId);
    return user ? this.publicSession(user, session) : null;
  }

  logout(cookieHeader) {
    const token = cookieValue(cookieHeader, "narraops_session");
    if (token) this.store.sessions = this.store.sessions.filter(({ tokenHash }) => !safeEqual(tokenHash, sha256(token)));
    this.#save();
  }

  completeOnboarding(cookieHeader) {
    const session = this.authenticate(cookieHeader);
    if (!session) throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Sign in before completing onboarding");
    const user = this.store.users.find(({ userId }) => userId === session.user.userId);
    user.onboardingCompleted = true;
    user.updatedAt = new Date(this.now()).toISOString();
    this.#save();
    return { completed: true };
  }

  publicSession(user, session) {
    return { authenticated: true, user: { userId: user.userId, identities: user.identities, primaryIdentity: user.primaryIdentity, onboardingCompleted: user.onboardingCompleted === true }, expiresAt: session.expiresAt };
  }

  #verifyChallenge({ challengeId, signature }) {
    const challenge = this.challenges.get(challengeId);
    this.challenges.delete(challengeId);
    if (!challenge || challenge.used || Date.parse(challenge.expiresAt) <= this.now()) throw new ApiError(400, "AUTH_CHALLENGE_INVALID", "Login challenge is missing, used, or expired");
    let valid = false;
    try {
      if (challenge.chain === "evm") valid = safeEqual(getAddress(verifyMessage(challenge.message, signature)), challenge.address);
      else valid = nacl.sign.detached.verify(Buffer.from(challenge.message, "utf8"), Buffer.from(signature, "base64"), bs58.decode(challenge.address));
    } catch { valid = false; }
    if (!valid) throw new ApiError(401, "WALLET_SIGNATURE_INVALID", "Wallet signature could not be verified");
    return challenge;
  }

  #load() {
    if (!this.filePath || !existsSync(this.filePath)) return { format: "narraops-web3-auth-v1", users: [], sessions: [] };
    try {
      const data = JSON.parse(readFileSync(this.filePath, "utf8"));
      if (data?.format !== "narraops-web3-auth-v1" || !Array.isArray(data.users) || !Array.isArray(data.sessions)) throw new Error();
      return data;
    } catch { throw new ApiError(500, "AUTH_STORE_CORRUPTED", "Web3 authentication store cannot be read safely"); }
  }

  #save() {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.store)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.filePath);
  }
}
