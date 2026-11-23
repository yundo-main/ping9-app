// 리눅스 라우터의 `net.ipv4.ip_forward` (T16.1). `sysctl` 명령이 내는 Command다.
// false면 Router가 자기 것이 아닌 패킷을 전달하지 않는다. 기본값은 켜짐(생략).

import type { CommandHandler } from "../reducer";
import { findRouter, withRouterConfig } from "./router-common";

export const setIpForward: CommandHandler<"router/set-ip-forward"> = (document, command) => {
  const found = findRouter(document, command.deviceId);
  if (!found.ok) return found;
  return withRouterConfig(document, found.device, { ...found.device.config, ipForward: command.enabled });
};
