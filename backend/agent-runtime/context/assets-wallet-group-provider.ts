import type {
  ActorRef,
  ContextProvider,
  ContextRef,
  ResolvedContextRef,
} from "../contracts/index.ts";
import { ContextResolutionError, contextDigest } from "./resolver.ts";

export interface PublicWalletGroup {
  groupId: string;
  name?: string;
  purpose?: string;
  network?: string;
  walletCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface PublicWallet {
  walletId: string;
  groupId?: string;
  publicAddress?: string | null;
  provisioningStatus?: string;
}

export interface WalletGroupContextRepository {
  listGroups(actorId: string): Promise<PublicWalletGroup[]> | PublicWalletGroup[];
  listWallets(groupId: string, actorId: string): Promise<PublicWallet[]> | PublicWallet[];
}

export class AssetsWalletGroupContextProvider implements ContextProvider {
  readonly kind = "assets.wallet_group" as const;

  constructor(readonly repository: WalletGroupContextRepository) {}

  async resolve(actor: ActorRef, ref: ContextRef, _signal: AbortSignal): Promise<ResolvedContextRef> {
    const groups = await this.repository.listGroups(actor.actorId);
    const group = groups.find((candidate) => candidate.groupId === ref.id);
    if (!group) {
      throw new ContextResolutionError(
        "ASSETS_WALLET_GROUP_NOT_FOUND",
        "Assets wallet group was not found for the authenticated actor",
      );
    }
    const wallets = await this.repository.listWallets(group.groupId, actor.actorId);
    const safeData = {
      groupId: group.groupId,
      name: group.name || null,
      purpose: group.purpose || "general",
      network: group.network || null,
      walletCount: Number(group.walletCount ?? wallets.length),
      wallets: wallets.slice(0, 200).map((wallet) => ({
        walletId: wallet.walletId,
        publicAddress: wallet.publicAddress || null,
        provisioningStatus: wallet.provisioningStatus || "unknown",
      })),
      updatedAt: group.updatedAt || group.createdAt || null,
    };
    return {
      kind: this.kind,
      id: group.groupId,
      version: group.updatedAt || group.createdAt,
      digest: contextDigest(safeData),
      safeData,
      resolvedAt: new Date().toISOString(),
    };
  }
}
