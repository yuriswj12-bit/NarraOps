import { randomUUID } from "node:crypto";
import { Wallet } from "ethers";
import { Keypair } from "@solana/web3.js";
import { sealWalletSecret } from "./encrypted-wallet-vault.js";
import { ExecutionError } from "./errors.js";

export class WalletProvisioningService {
  constructor({ walletRepository, password }) {
    if (!walletRepository) throw new ExecutionError("WALLET_STORE_CONFIG_REQUIRED", "Encrypted wallet repository is required");
    if (typeof password !== "string" || password.length < 16) throw new ExecutionError("WALLET_VAULT_PASSWORD_REQUIRED", "Wallet vault password must contain at least 16 characters");
    this.walletRepository = walletRepository;
    this.password = password;
  }

  async provision({ walletId = randomUUID() } = {}) {
    const evm = Wallet.createRandom();
    const solana = Keypair.generate();
    const evmReferenceId = `${walletId}:evm`;
    const solanaReferenceId = `${walletId}:solana`;
    const solanaPrivateKey = Buffer.from(solana.secretKey).toString("base64");
    try {
      await this.walletRepository.putEncryptedWallet(sealWalletSecret({ walletReferenceId: evmReferenceId, publicAddress: evm.address, privateKey: evm.privateKey, password: this.password }));
      await this.walletRepository.putEncryptedWallet(sealWalletSecret({ walletReferenceId: solanaReferenceId, publicAddress: solana.publicKey.toBase58(), privateKey: solanaPrivateKey, password: this.password }));
    } finally {
      solana.secretKey.fill(0);
    }
    return {
      walletId,
      publicAddress: evm.address,
      addresses: { bsc: evm.address, robinhood: evm.address, solana: solana.publicKey.toBase58() },
      signerReferences: { evm: evmReferenceId, solana: solanaReferenceId },
      custodyMode: "narraops_encrypted_vault",
      provisioningStatus: "active",
      exportEligible: false,
    };
  }
}
