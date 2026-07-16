import { loadConfig } from "./config.mjs";
import { createLogger } from "./security.mjs";
import { createApplication } from "./app.mjs";
import { LaunchPlanningService } from "./launch-service.mjs";
import { resolve } from "node:path";
import { EncryptedWalletRepository, WalletProvisioningService } from "../../execution/index.js";
import { InMemoryWalletGroupRepository } from "./repositories/in-memory-wallet-group-repository.mjs";

const config = loadConfig();
const logger = createLogger(config.logLevel);
const launchService = new LaunchPlanningService(config);
const walletProvisioningService = config.walletVaultPassword
  ? new WalletProvisioningService({ walletRepository: new EncryptedWalletRepository({ filePath: resolve(config.walletStorePath) }), password: config.walletVaultPassword })
  : null;
const walletGroupRepository = new InMemoryWalletGroupRepository({ seed: !walletProvisioningService, filePath: resolve(config.walletGroupStorePath) });
if (walletProvisioningService) {
  for (const group of walletGroupRepository.listGroups()) {
    for (const wallet of walletGroupRepository.listWallets(group.groupId).filter(({ provisioningStatus }) => provisioningStatus !== "active")) {
      walletGroupRepository.activateWallet(wallet.walletId, await walletProvisioningService.provision({ walletId: wallet.walletId }));
    }
  }
}
const application = createApplication({ config, logger, launchService, walletProvisioningService, walletGroupRepository });

application.server.listen(config.port, config.host, () => {
  logger.info("api_started", {
    address: `http://${config.host}:${config.port}`,
    health: "/api/v1/health",
    mode: "client-signed-launch-planning",
  });
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await application.close();
    process.exit(0);
  });
}
