// reducer: `router/set-static-nat` (T16.2). 정적 NAT 1:1 대응을 더하거나 지운다.
// `ip nat inside source static <inside> <outside>`(IOS)가 이 명령을 보낸다.
// outsideIp가 null이면 insideIp의 대응을 지운다.

import { checkHostIpv4, errorInfo } from "@ping9/shared";

import type { CommandHandler } from "../reducer";
import { findRouter, withRouterConfig } from "./router-common";

export const setStaticNat: CommandHandler<"router/set-static-nat"> = (document, command) => {
  const found = findRouter(document, command.deviceId);
  if (!found.ok) return found;
  const { device } = found;
  const insideError = checkHostIpv4(command.insideIp);
  if (insideError !== null) return { ok: false, error: insideError };
  const statics = device.config.natStatics ?? [];
  if (command.outsideIp === null) {
    const next = statics.filter(entry => entry.insideIp !== command.insideIp);
    if (next.length === statics.length) {
      return { ok: false, error: errorInfo("NAT_STATIC_NOT_FOUND", { deviceId: device.id, insideIp: command.insideIp }) };
    }
    return withRouterConfig(document, device, { ...device.config, natStatics: next });
  }
  const outsideError = checkHostIpv4(command.outsideIp);
  if (outsideError !== null) return { ok: false, error: outsideError };
  if (command.insideIp === command.outsideIp) {
    return { ok: false, error: errorInfo("NAT_STATIC_SAME_ADDRESS", { ip: command.insideIp }) };
  }
  const entry = { insideIp: command.insideIp, outsideIp: command.outsideIp };
  // 같은 안쪽 주소의 대응이 있으면 바깥 주소만 바꾼다 (실제 IOS와 같음)
  const existing = statics.find(candidate => candidate.insideIp === command.insideIp);
  const natStatics = existing === undefined ? [...statics, entry] : statics.map(candidate => candidate === existing ? entry : candidate);
  return withRouterConfig(document, device, { ...device.config, natStatics });
};
