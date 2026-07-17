import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ExecutionError } from "./errors.js";

export class EncryptedWalletRepository {
  constructor({ filePath }) {
    if (!filePath) throw new ExecutionError("WALLET_STORE_CONFIG_REQUIRED", "Encrypted wallet store path is required");
    this.filePath = filePath;
    this.writeQueue = Promise.resolve();
  }

  async readStore() {
    try {
      const payload = JSON.parse(await readFile(this.filePath, "utf8"));
      if (payload?.format !== "narraops-wallet-store-v1" || typeof payload.wallets !== "object") throw new Error();
      return payload;
    } catch (error) {
      if (error.code === "ENOENT") return { format: "narraops-wallet-store-v1", wallets: {} };
      throw new ExecutionError("WALLET_STORE_CORRUPTED", "Encrypted wallet store cannot be read safely");
    }
  }

  async getEncryptedWallet(walletReferenceId) {
    return (await this.readStore()).wallets[walletReferenceId] || null;
  }

  async putEncryptedWallet(envelope) {
    if (!envelope?.walletReferenceId || !envelope?.publicAddress || !envelope?.ciphertext) {
      throw new ExecutionError("INVALID_WALLET_SECRET", "A complete encrypted wallet envelope is required");
    }
    this.writeQueue = this.writeQueue.then(async () => {
      const store = await this.readStore();
      store.wallets[envelope.walletReferenceId] = envelope;
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(store)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    });
    await this.writeQueue;
    return { walletReferenceId: envelope.walletReferenceId, publicAddress: envelope.publicAddress };
  }
}

