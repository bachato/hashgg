import { compat, types as T } from "../deps.ts";

export const properties: T.ExpectedExports.properties = async (effects) => {
  const state = await readState(effects);
  const data: T.PackagePropertiesV2 = {};

  if (state.public_endpoint) {
    data["Mining Endpoint"] = {
      type: "string",
      value: `stratum+tcp://${state.public_endpoint}`,
      description: "Point your miners (or Braiins Hashpower) to this address",
      copyable: true,
      masked: false,
      qr: false,
    };
  }

  data["Tunnel Status"] = {
    type: "string",
    value: state.agent_status || "unknown",
    description: "Current status of the playit.gg tunnel agent",
    copyable: false,
    masked: false,
    qr: false,
  };

  return { result: { version: 2 as const, data } };
};

async function readState(effects: any): Promise<{ public_endpoint: string | null; agent_status: string }> {
  try {
    const data = await effects.readFile({
      volumeId: "main",
      path: "data/state.json",
    });
    return JSON.parse(data);
  } catch {
    return { public_endpoint: null, agent_status: "unknown" };
  }
}
