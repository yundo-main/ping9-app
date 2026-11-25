// 리눅스 라우터의 SSH 수신 설정 (T0.56). `systemctl`로 sshd를 켜고 `useradd`로 계정을 만든다.
// 단순화: `useradd -p`는 실제로 암호 해시를 기대하지만 여기서는 평문 비밀번호를 받는다.

import { routerSshOpen } from "@ping9/shared";
import type { RouterSshConfig } from "@ping9/shared";

import { customParam, defineCommand, linesFromDispatch, param } from "../ios";
import type { CommandArgs, CommandContext, CommandDefinition, CommandOutcome, ParamValue } from "../ios";
import { errorInfo } from "@ping9/shared";

const text = (value: string) => ({ kind: "text" as const, text: value });

const linux = (tokens: CommandDefinition["tokens"], help: string, run: CommandDefinition["run"]) =>
  defineCommand({ modes: ["user"], devices: ["router"], tokens, help, run, caseSensitive: true });

function patchSsh(context: CommandContext, patch: Partial<RouterSshConfig>): CommandOutcome {
  const device = context.device;
  if (device.kind !== "router") return {};
  const ssh: RouterSshConfig = { users: [], ...device.config.ssh, ...patch };
  return { lines: linesFromDispatch(context.dispatch({ type: "router/set-ssh", deviceId: device.id, ssh })) };
}

function readService(value: string): ParamValue {
  const name = value.replace(/\.service$/, "");
  return name === "ssh" || name === "sshd"
    ? { ok: true, value: "ssh" }
    : { ok: false, error: errorInfo("CLI_INVALID_VALUE", { token: value.slice(0, 32) }) };
}
const serviceParam = customParam("service", "Service: ssh (sshd)", readService);

const setEnabled = (enabled: boolean) => (_args: CommandArgs, context: CommandContext): CommandOutcome =>
  patchSsh(context, { enabled });

const status = (_args: CommandArgs, context: CommandContext): CommandOutcome => {
  const device = context.device;
  if (device.kind !== "router") return {};
  const active = routerSshOpen(device.config);
  const users = device.config.ssh?.users.length ?? 0;
  return {
    lines: [
      text(`${active ? "●" : "○"} ssh.service - OpenBSD Secure Shell server`),
      text(`     Active: ${active ? "active (running)" : "inactive (dead)"}`),
      ...(active ? [text("     Listen: tcp/22"), text(`     Accounts: ${users}`)] : []),
    ],
  };
};

const addUser = (args: CommandArgs, context: CommandContext): CommandOutcome => {
  const device = context.device;
  if (device.kind !== "router") return {};
  const users = (device.config.ssh?.users ?? []).filter((account) => account.user !== String(args["name"]));
  return patchSsh(context, { users: [...users, { user: String(args["name"]), password: String(args["password"] ?? "") }] });
};

const removeUser = (args: CommandArgs, context: CommandContext): CommandOutcome => {
  const device = context.device;
  if (device.kind !== "router") return {};
  return patchSsh(context, { users: (device.config.ssh?.users ?? []).filter((account) => account.user !== String(args["name"])) });
};

const nameParam = customParam("name", "User name (letters, digits, . _ -)", (value) =>
  /^[A-Za-z0-9._-]{1,32}$/.test(value)
    ? { ok: true, value }
    : { ok: false, error: errorInfo("CLI_INVALID_VALUE", { token: value.slice(0, 32) }) });
const passwordParam = param("password", "word", "Login password");

export const LINUX_ROUTER_SSH_COMMANDS: readonly CommandDefinition[] = [
  linux(["systemctl", "start", serviceParam], "Start the SSH server", setEnabled(true)),
  linux(["systemctl", "enable", serviceParam], "Enable the SSH server", setEnabled(true)),
  linux(["systemctl", "stop", serviceParam], "Stop the SSH server", setEnabled(false)),
  linux(["systemctl", "disable", serviceParam], "Disable the SSH server", setEnabled(false)),
  linux(["systemctl", "status", serviceParam], "Show SSH server status", status),
  linux(["useradd", nameParam, "-p", passwordParam], "Create a login account (plain-text password)", addUser),
  linux(["useradd", nameParam, "--password", passwordParam], "Create a login account (plain-text password)", addUser),
  linux(["userdel", nameParam], "Remove a login account", removeUser),
];
