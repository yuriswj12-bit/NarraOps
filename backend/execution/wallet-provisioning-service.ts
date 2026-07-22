// @ts-nocheck
import { randomUUID } from "node:crypto";
import { Wallet } from "ethers";
import { Keypair } from "@solana/web3.js";
import { sealWalletSecret } from "./encrypted-wallet-vault.ts";
import { ExecutionError } from "./errors.ts";

export class WalletProvisioningService {
  constructor({ walletRepository, password }) {
    if (!walletRepository) throw new ExecutionError("WALLET_STORE_CONFIG_REQUIRED", "Encrypted wallet repository is required");
    if (typeof password !== "string" || password.length < 16) throw new ExecutionError("WALLET_VAULT_PASSWORD_REQUIRED", "Wallet vault password must contain at least 16 characters");
    this.walletRepository = walletRepository;
    this.password = password;
  }

  async provision({ walletId = randomUUID(), network = "multi" } = {}) {
    if (!["solana", "evm", "multi"].includes(network)) throw new ExecutionError("WALLET_NETWORK_UNSUPPORTED", "Wallet network must be solana or evm");
    const evm = network !== "solana" ? Wallet.createRandom() : null;
    const solana = network !== "evm" ? Keypair.generate() : null;
    const evmReferenceId = `${walletId}:evm`;
    const solanaReferenceId = `${walletId}:solana`;
    const solanaPrivateKey = solana ? Buffer.from(solana.secretKey).toString("base64") : null;
    try {
      if (evm) await this.walletRepository.putEncryptedWallet(sealWalletSecret({ walletReferenceId: evmReferenceId, publicAddress: evm.address, privateKey: evm.privateKey, password: this.password }));
      if (solana) await this.walletRepository.putEncryptedWallet(sealWalletSecret({ walletReferenceId: solanaReferenceId, publicAddress: solana.publicKey.toBase58(), privateKey: solanaPrivateKey, password: this.password }));
    } finally {
      solana?.secretKey.fill(0);
    }
    const evmAddress = evm?.address;
    const solanaAddress = solana?.publicKey.toBase58();
    return {
      walletId,
      publicAddress: evmAddress || solanaAddress,
      addresses: { ...(evmAddress ? { bsc: evmAddress, robinhood: evmAddress } : {}), ...(solanaAddress ? { solana: solanaAddress } : {}) },
      signerReferences: { ...(evmAddress ? { evm: evmReferenceId } : {}), ...(solanaAddress ? { solana: solanaReferenceId } : {}) },
      custodyMode: "narraops_encrypted_vault",
      provisioningStatus: "active",
      exportEligible: false,
    };
  }
}
