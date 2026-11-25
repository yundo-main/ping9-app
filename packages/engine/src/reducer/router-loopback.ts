// reducer: 루프백 인터페이스 (T0.57). `loopback/set`은 `interface LoopbackN`이 만들 때 보내고,
// `loopback/remove`는 `no interface LoopbackN`이 보낸다. 주소·켜짐은 interface/* 명령이 updateLoopback으로 바꾼다.

import { errorInfo, isLoopbackName } from "@ping9/shared";
import type { RouterDevice, RouterInterfaceConfig, TopologyDocument } from "@ping9/shared";
import type { CommandHandler, ReduceResult } from "../reducer";
import { findRouter, withRouterConfig } from "./router-common";

export function updateLoopback(document: TopologyDocument, device: RouterDevice, name: string, patch: Partial<RouterInterfaceConfig>): ReduceResult {
  const current = device.config.loopbacks?.[name];
  if (current === undefined) return { ok: false, error: errorInfo("TUNNEL_INVALID_CONFIG", { detail: `${name}: 먼저 interface loopback을 생성하세요` }) };
  return withRouterConfig(document, device, {
    ...device.config, loopbacks: { ...device.config.loopbacks, [name]: { ...current, ...patch } },
  });
}

export const setLoopback: CommandHandler<"loopback/set"> = (document, command) => {
  const found = findRouter(document, command.deviceId);
  if (!found.ok) return found;
  if (typeof command.name !== "string" || !isLoopbackName(command.name)) {
    return { ok: false, error: errorInfo("TUNNEL_INVALID_CONFIG", { detail: "Loopback0~Loopback3만 지원합니다" }) };
  }
  return withRouterConfig(document, found.device, {
    ...found.device.config, loopbacks: { ...found.device.config.loopbacks, [command.name]: command.config },
  });
};

export const removeLoopback: CommandHandler<"loopback/remove"> = (document, command) => {
  const found = findRouter(document, command.deviceId);
  if (!found.ok) return found;
  if (typeof command.name !== "string" || !isLoopbackName(command.name)) {
    return { ok: false, error: errorInfo("TUNNEL_INVALID_CONFIG", { detail: "Loopback0~Loopback3만 지원합니다" }) };
  }
  const loopbacks = Object.fromEntries(Object.entries(found.device.config.loopbacks ?? {}).filter(([name]) => name !== command.name));
  return withRouterConfig(document, found.device, { ...found.device.config, loopbacks });
};
