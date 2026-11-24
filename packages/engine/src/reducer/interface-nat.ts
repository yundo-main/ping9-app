// reducer: `interface/set-nat` (T16.2). Router 인터페이스에 NAT 역할을 준다.
// `ip nat inside`·`ip nat outside`(IOS)가 이 명령을 보낸다. nat이 null이면 역할을 지운다.

import { errorInfo } from "@ping9/shared";

import type { CommandHandler } from "../reducer";
import { checkRouterPort, findRouter, withRouterConfig } from "./router-common";

export const setInterfaceNat: CommandHandler<"interface/set-nat"> = (document, command) => {
  const found = findRouter(document, command.deviceId);
  if (!found.ok) return found;
  const device = found.device;
  const portError = checkRouterPort(device, command.port);
  if (portError !== null) return { ok: false, error: portError };
  if (command.nat !== "inside" && command.nat !== "outside" && command.nat !== null) {
    return { ok: false, error: errorInfo("DOCUMENT_INVALID_SHAPE", { path: "nat" }) };
  }
  const iface = device.config.interfaces[command.port];
  const next = { adminUp: iface?.adminUp ?? false, ...iface };
  if (command.nat === null) delete next.nat; else next.nat = command.nat;
  return withRouterConfig(document, device, {
    ...device.config,
    interfaces: { ...device.config.interfaces, [command.port]: next },
  });
};
