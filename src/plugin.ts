import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import {
  EINKO_PLUGIN_ID,
  einkoPluginConfigSchema,
  resolveEinkoPluginConfig,
  resolveWorkspaceRoot,
} from "./config.js";
import { createScreenshotUploadHandler } from "./http.js";

const plugin = definePluginEntry({
  id: EINKO_PLUGIN_ID,
  name: "Einko Screenshot Webhook",
  description: "Accept authenticated screenshot uploads and store them in the OpenClaw workspace.",
  configSchema: einkoPluginConfigSchema,
  register(api: OpenClawPluginApi) {
    const config = resolveEinkoPluginConfig(api.pluginConfig);
    const workspaceRoot = resolveWorkspaceRoot(api.config);

    api.registerHttpRoute({
      path: config.routePath,
      auth: "plugin",
      match: "exact",
      handler: createScreenshotUploadHandler({
        config,
        workspaceRoot,
        logger: api.logger,
      }),
    });

    if (!config.authToken) {
      api.logger.warn("einko-plugin is enabled without an authToken; upload requests will be rejected");
    }
  },
});

export default plugin;
