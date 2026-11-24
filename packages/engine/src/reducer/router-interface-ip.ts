import { checkInterfaceAddress, checkRouterInterfaceOverlap, errorInfo, isTunnelName, routerInterfaces } from "@ping9/shared";
import type { Notice } from "@ping9/shared";

import { describeValue } from "../describe";
import type { CommandHandler } from "../reducer";
import { findL3Switch, l3ClearInterfaceIp, l3SetInterfaceIp } from "./l3switch";
import { checkRouterPort, findRouter, withRouterConfig } from "./router-common";
import { updateTunnel } from "./router-tunnel";

export const setRouterInterfaceIp: CommandHandler<"interface/set-ip"> = (document, command) => {
  const l3 = findL3Switch(document, command.deviceId);
  if (l3.ok) return l3SetInterfaceIp(document, l3.device, command);
  const found = findRouter(document, command.deviceId);
  if (!found.ok) return found;
  const device = found.device;
  if (typeof command.port === "string" && isTunnelName(command.port)) return updateTunnel(document, device, command.port, { ip: command.ip, mask: command.mask });
  const portError = checkRouterPort(device, command.port);
  if (portError !== null) return { ok: false, error: portError };

  if (typeof command.ip !== "string" || command.ip.length > 64) {
    return { ok: false, error: errorInfo("INVALID_IPV4", { value: describeValue(command.ip) }) };
  }
  if (typeof command.mask !== "string" || command.mask.length > 64) {
    return { ok: false, error: errorInfo("INVALID_MASK", { value: describeValue(command.mask) }) };
  }
  const addressError = checkInterfaceAddress(command.ip, command.mask);
  if (addressError !== null) return { ok: false, error: addressError };
  const overlap = checkRouterInterfaceOverlap(device.id, command.port, command.ip, command.mask, routerInterfaces(device.config));
  if (overlap !== null) return { ok: false, error: overlap };

  const others = document.devices.filter(other => other.id !== device.id && (
    (other.kind === "pc" || other.kind === "server") ? other.config.ip === command.ip :
      other.kind === "router" && Object.values(other.config.interfaces).some(iface => iface.ip === command.ip)
  )).map(other => ({ deviceId: other.id, deviceName: other.name }));
  const notices: readonly Notice[] = others.length === 0 ? [] : [{ code: "DUPLICATE_IP", params: { ip: command.ip, others } }];
  return withRouterConfig(document, device, {
    ...device.config,
    interfaces: {
      ...device.config.interfaces,
      [command.port]: {
        adminUp: device.config.interfaces[command.port]?.adminUp ?? false,
        ip: command.ip, mask: command.mask,
      },
    },
  }, notices);
};

export const clearRouterInterfaceIp: CommandHandler<"interface/clear-ip"> = (document, command) => {
  const l3 = findL3Switch(document, command.deviceId);
  if (l3.ok) return l3ClearInterfaceIp(document, l3.device, command);
  const found = findRouter(document, command.deviceId);
  if (!found.ok) return found;
  const device = found.device;
  if (typeof command.port === "string" && isTunnelName(command.port)) {
    const tunnel = device.config.tunnels?.[command.port];
    if (tunnel !== undefined) {
      const { mode, adminUp, source, destination } = tunnel;
      const rest = { mode, adminUp, ...(source === undefined ? {} : { source }), ...(destination === undefined ? {} : { destination }) };
      return withRouterConfig(document, device, { ...device.config, tunnels: { ...device.config.tunnels, [command.port]: rest } });
    }
  }
  const portError = checkRouterPort(device, command.port);
  if (portError !== null) return { ok: false, error: portError };
  return withRouterConfig(document, device, {
    ...device.config,
    interfaces: {
      ...device.config.interfaces,
      [command.port]: { adminUp: device.config.interfaces[command.port]?.adminUp ?? false },
    },
  });
};
