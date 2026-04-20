import { compat, types as T } from "../deps.ts";

export const migration: T.ExpectedExports.migration =
  compat.migrations.fromMapping(
    {
      "0.1.0": {
        up: compat.migrations.updateConfig(
          (config) => {
            return config;
          },
          false,
          { version: "0.1.0", type: "up" }
        ),
        down: compat.migrations.updateConfig(
          (config) => {
            return config;
          },
          false,
          { version: "0.1.0", type: "down" }
        ),
      },
      "0.2.0": {
        up: compat.migrations.updateConfig(
          (config) => {
            return config;
          },
          false,
          { version: "0.2.0", type: "up" }
        ),
        down: compat.migrations.updateConfig(
          (config) => {
            return config;
          },
          false,
          { version: "0.2.0", type: "down" }
        ),
      },
      "0.3.0": {
        up: compat.migrations.updateConfig(
          (config) => {
            // 0.3.0.0: Added VPS SSH tunnel as alternative to playit.gg.
            // No config schema change — VPS settings are managed via the web UI
            // and persisted in /root/data/state.json. Existing playit.gg users
            // are auto-migrated to tunnel_mode='playit' on first run of the
            // new backend (see app/backend/state.js load()).
            return config;
          },
          false,
          { version: "0.3.0", type: "up" }
        ),
        down: compat.migrations.updateConfig(
          (config) => {
            return config;
          },
          false,
          { version: "0.3.0", type: "down" }
        ),
      },
    },
    "0.3.0.0"
  );
