import { types as T } from "../deps.ts";

export const dependencies: T.ExpectedExports.dependencies = {
  datum: {
    // deno-lint-ignore require-await
    async check(_effects, _configInput) {
      // Datum Gateway just needs to be installed and running.
      // No specific config requirements from our side.
      return { result: null };
    },
    // deno-lint-ignore require-await
    async autoConfigure(_effects, configInput) {
      // We don't modify Datum Gateway's config.
      return { result: configInput };
    },
  },
};
