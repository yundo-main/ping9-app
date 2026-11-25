// 라우터의 SSH 수신 설정 (T0.56). IOS 스타일: 계정·domain-name·RSA 키 셋이 모두 있으면 SSH가 켜진다.
// 단순화: `line vty`/`transport input ssh`/`login local`은 시뮬레이션하지 않는다 — 셋만 갖추면 TCP/22를 연다.

import { routerSshOpen } from "@ping9/shared";
import type { RouterSshConfig } from "@ping9/shared";

import { customParam, defineCommand, linesFromDispatch, param } from "../ios";
import type { CommandArgs, CommandContext, CommandDefinition, CommandOutcome, ParamValue } from "../ios";
import { errorInfo } from "@ping9/shared";

const text = (value: string) => ({ kind: "text" as const, text: value });

/** 지금 설정에 패치를 얹은 새 ssh 설정으로 `router/set-ssh`를 낸다 */
function patchSsh(context: CommandContext, patch: Partial<RouterSshConfig>): CommandOutcome {
  const device = context.device;
  if (device.kind !== "router") return {};
  const ssh: RouterSshConfig = { users: [], ...device.config.ssh, ...patch };
  return { lines: linesFromDispatch(context.dispatch({ type: "router/set-ssh", deviceId: device.id, ssh })) };
}

function readName(value: string): ParamValue {
  return /^[A-Za-z0-9._-]{1,32}$/.test(value)
    ? { ok: true, value }
    : { ok: false, error: errorInfo("CLI_INVALID_VALUE", { token: value.slice(0, 32) }) };
}

const nameParam = customParam("name", "User name (letters, digits, . _ -)", readName);
const secretParam = param("secret", "word", "Login password");
const domainParam = param("domain", "word", "Domain name, e.g. ping9.test");

const config = (tokens: CommandDefinition["tokens"], help: string, run: CommandDefinition["run"]) =>
  defineCommand({ modes: ["config"], devices: ["router"], tokens, help, run });

const setKey = (args: CommandArgs, context: CommandContext): CommandOutcome => {
  const device = context.device;
  if (device.kind !== "router") return {};
  if (device.config.ssh?.domainName === undefined) {
    return { lines: [text("% Please define a domain-name first.")] };
  }
  const bits = args["modulus"] === undefined ? 1024 : Number(args["modulus"]);
  const outcome = patchSsh(context, { keyBits: bits });
  return {
    ...outcome,
    lines: [
      ...(outcome.lines ?? []),
      text(`The name for the keys will be: ${device.name}.${device.config.ssh.domainName}`),
      text("The key modulus size is " + bits + " bits"),
    ],
  };
};

function readModulus(value: string): ParamValue {
  return /^[0-9]+$/.test(value) && Number(value) >= 512 && Number(value) <= 2048
    ? { ok: true, value: Number(value) }
    : { ok: false, error: errorInfo("CLI_INVALID_VALUE", { token: value.slice(0, 32) }) };
}
const modulusParam = customParam("modulus", "Modulus bits 512-2048", readModulus);

const addUser = (args: CommandArgs, context: CommandContext): CommandOutcome => {
  const device = context.device;
  if (device.kind !== "router") return {};
  const users = (device.config.ssh?.users ?? [])
    .filter((account) => account.user !== String(args["name"]));
  return patchSsh(context, { users: [...users, { user: String(args["name"]), password: String(args["secret"]) }] });
};

const removeUser = (args: CommandArgs, context: CommandContext): CommandOutcome => {
  const device = context.device;
  if (device.kind !== "router") return {};
  return patchSsh(context, { users: (device.config.ssh?.users ?? []).filter((account) => account.user !== String(args["name"])) });
};

const showSsh = (_args: CommandArgs, context: CommandContext): CommandOutcome => {
  const device = context.device;
  if (device.kind !== "router") return {};
  if (!routerSshOpen(device.config)) return { lines: [text("SSH Disabled - version 1.99")] };
  const ssh = device.config.ssh!;
  return {
    lines: [
      text("SSH Enabled - version 2.0"),
      text(`Authentication timeout: 120 secs; Authentication retries: 3`),
      text(`Minimum expected Diffie Hellman key size : 1024 bits`),
      text(`Domain name: ${ssh.domainName}   RSA key size: ${ssh.keyBits} bits   Accounts: ${ssh.users.length}`),
    ],
  };
};

export const ROUTER_SSH_COMMANDS: readonly CommandDefinition[] = [
  config(["ip", "domain-name", domainParam], "Define a domain name (required for SSH)", (args, context) =>
    patchSsh(context, { domainName: String(args["domain"]) })),
  config(["no", "ip", "domain-name"], "Remove the domain name (turns SSH off)", (_args, context) => patchSsh(context, { domainName: undefined })),
  config(["crypto", "key", "generate", "rsa"], "Generate RSA keys for SSH", setKey),
  config(["crypto", "key", "generate", "rsa", "modulus", modulusParam], "Generate RSA keys with a modulus size", setKey),
  config(["crypto", "key", "generate", "rsa", "general-keys", "modulus", modulusParam], "Generate general-purpose RSA keys", setKey),
  config(["crypto", "key", "zeroize", "rsa"], "Delete the RSA keys (turns SSH off)", (_args, context) => patchSsh(context, { keyBits: undefined })),
  config(["username", nameParam, "secret", secretParam], "Create a local login account", addUser),
  config(["no", "username", nameParam], "Remove a local login account", removeUser),
  defineCommand({ modes: ["privileged"], devices: ["router"], tokens: ["show", "ip", "ssh"], help: "Show SSH status", run: showSsh }),
];
