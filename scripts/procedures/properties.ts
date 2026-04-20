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

  if (state.tunnel_mode === "vps") {
    data["Tunnel Type"] = {
      type: "string",
      value: "VPS Tunnel (SSH)",
      description: "Tunnel method in use",
      copyable: false,
      masked: false,
      qr: false,
    };
    if (state.vps_host) {
      data["VPS Host"] = {
        type: "string",
        value: state.vps_host,
        description: "IP address or hostname of the VPS providing the tunnel",
        copyable: true,
        masked: false,
        qr: false,
      };
    }
    data["Tunnel Status"] = {
      type: "string",
      value: state.vps_tunnel_status || "disconnected",
      description: "Current status of the SSH tunnel",
      copyable: false,
      masked: false,
      qr: false,
    };
    if (state.vps_last_error) {
      data["Last Error"] = {
        type: "string",
        value: state.vps_last_error,
        description: "Last SSH tunnel error",
        copyable: false,
        masked: false,
        qr: false,
      };
    }
  } else {
    data["Tunnel Type"] = {
      type: "string",
      value: "Playit.gg",
      description: "Tunnel method in use",
      copyable: false,
      masked: false,
      qr: false,
    };
    data["Tunnel Status"] = {
      type: "string",
      value: state.agent_status || "unknown",
      description: "Current status of the playit.gg tunnel agent",
      copyable: false,
      masked: false,
      qr: false,
    };
  }

  return { result: { version: 2 as const, data } };
};

async function readState(effects: any): Promise<{
  public_endpoint: string | null;
  tunnel_mode: string | null;
  agent_status: string;
  vps_host: string | null;
  vps_tunnel_status: string;
  vps_last_error: string | null;
}> {
  try {
    const data = await effects.readFile({
      volumeId: "main",
      path: "data/state.json",
    });
    return JSON.parse(data);
  } catch {
    return {
      public_endpoint: null,
      tunnel_mode: null,
      agent_status: "unknown",
      vps_host: null,
      vps_tunnel_status: "disconnected",
      vps_last_error: null,
    };
  }
}
