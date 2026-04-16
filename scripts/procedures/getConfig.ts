import { compat, types as T } from "../deps.ts";

export const getConfig: T.ExpectedExports.getConfig = compat.getConfig({
  playit: {
    type: "object",
    name: "Playit.gg Settings",
    description: "Settings for the playit.gg tunnel agent",
    spec: {
      secret_key: {
        type: "string",
        name: "Secret Key",
        description:
          "Playit.gg agent secret key. Leave empty to use the web UI claim flow instead.",
        nullable: true,
        masked: true,
      },
    },
  },
  advanced: {
    type: "object",
    name: "Advanced",
    description: "Advanced settings — most users should leave these at defaults",
    spec: {
      datum_stratum_port: {
        type: "number",
        name: "Datum Stratum Port",
        description:
          "The stratum port on Datum Gateway to forward traffic to. Must match Datum Gateway's configured stratum listen port.",
        nullable: false,
        range: "[1,65535]",
        integral: true,
        default: 23335,
      },
    },
  },
});
