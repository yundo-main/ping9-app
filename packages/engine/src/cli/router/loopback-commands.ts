// `no interface LoopbackN` — 루프백을 지운다 (T0.57). 만드는 `interface LoopbackN`은
// 공통 interface 명령(ios/interface-commands.ts)이 처리한다.

import { isLoopbackName } from "@ping9/shared";

import { customParam, defineCommand, linesFromDispatch } from "../ios";
import type { CommandDefinition, ParamValue } from "../ios";
import { errorInfo } from "@ping9/shared";
import { resolvePortName } from "../ios/port-name";

const LOOPBACK = customParam("loopback", "Loopback0-Loopback3", (text, kind): ParamValue => {
  const name = resolvePortName(kind, text);
  return name !== undefined && isLoopbackName(name)
    ? { ok: true, value: name }
    : { ok: false, error: errorInfo("CLI_INVALID_VALUE", { token: text.slice(0, 32) }) };
});

export const ROUTER_LOOPBACK_COMMANDS: readonly CommandDefinition[] = [
  defineCommand({ modes: ["config"], devices: ["router"], tokens: ["no", "interface", LOOPBACK],
    help: "Remove a loopback interface",
    run: (args, context) => ({
      lines: linesFromDispatch(context.dispatch({ type: "loopback/remove", deviceId: context.device.id, name: String(args.loopback) })),
    }) }),
];
