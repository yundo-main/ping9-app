import { errorInfo, validateDocument } from "@ping9/shared";
import type { CommandHandler } from "../reducer";
import { findRouter, withRouterConfig } from "./router-common";

export const setCliStyle: CommandHandler<"router/set-cli-style"> = (document, command) => {
  const found = findRouter(document, command.deviceId);
  if (!found.ok) return found;
  if (!["ios", "vyos", "linux"].includes(command.style)) return { ok: false, error: errorInfo("CLI_INVALID_VALUE", { token: "cliStyle" }) };
  return withRouterConfig(document, found.device, { ...found.device.config, cliStyle: command.style,
    ...(command.style === "vyos" ? { vpnMode: undefined } : {}),
    ...(command.style === "ios" ? { vyos: undefined } : {}) });
};

/** SSH 수신 설정을 통째로 바꾼다 (T0.56). 형태는 스키마가 보고 여기서는 최소한만 본다 */
export const setRouterSsh: CommandHandler<"router/set-ssh"> = (document, command) => {
  const found = findRouter(document, command.deviceId);
  if (!found.ok) return found;
  const ssh = command.ssh;
  const valid = ssh === null || (typeof ssh === "object" && Array.isArray(ssh.users) &&
    ssh.users.every((user: unknown) => typeof user === "object" && user !== null &&
      typeof (user as Record<string, unknown>)["user"] === "string" &&
      typeof (user as Record<string, unknown>)["password"] === "string"));
  if (!valid) return { ok: false, error: errorInfo("DOCUMENT_INVALID_SHAPE", { path: "ssh" }) };
  return withRouterConfig(document, found.device, { ...found.device.config, ssh: ssh ?? undefined });
};

export const commitVyos: CommandHandler<"router/commit-vyos"> = (document, command) => {
  const found = findRouter(document, command.deviceId);
  if (!found.ok) return found;
  const checked = validateDocument({ ...document, devices: document.devices.map(device => device.id === command.deviceId ? { ...device, config: command.config } : device) });
  if (!checked.ok) return checked;
  return withRouterConfig(document, found.device, command.config);
};
