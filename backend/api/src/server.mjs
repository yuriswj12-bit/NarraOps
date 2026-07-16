import { loadConfig } from "./config.mjs";
import { createLogger } from "./security.mjs";
import { createApplication } from "./app.mjs";
import { LaunchPlanningService } from "./launch-service.mjs";

const config = loadConfig();
const logger = createLogger(config.logLevel);
const launchService = new LaunchPlanningService(config);
const application = createApplication({ config, logger, launchService });

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
