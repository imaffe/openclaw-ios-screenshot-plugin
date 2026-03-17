import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import {
  OPENCLAW_IOS_SCREENSHOT_PLUGIN_ID,
  openClawIosScreenshotPluginConfigSchema,
  resolveOpenClawIosScreenshotPluginConfig,
  resolveWorkspaceRoot,
} from "./config.js";
import { createScreenshotUploadHandler } from "./http.js";

const plugin = definePluginEntry({
  id: OPENCLAW_IOS_SCREENSHOT_PLUGIN_ID,
  name: "OpenClaw iOS Screenshot Plugin",
  description: "Accept authenticated screenshot uploads and store them in the OpenClaw workspace.",
  configSchema: openClawIosScreenshotPluginConfigSchema,
  register(api: OpenClawPluginApi) {
    const config = resolveOpenClawIosScreenshotPluginConfig(api.pluginConfig);
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
      api.logger.warn("openclaw-ios-screenshot-plugin is enabled without an authToken; upload requests will be rejected");
    }
  },
});

export default plugin;
