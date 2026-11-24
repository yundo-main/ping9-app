import { defineCommand, linesFromDispatch, param } from "../ios";
import type { CommandDefinition } from "../ios";

// `ip nat inside source static <inside> <outside>`·`no ...` (T16.2). 1:1 호스트 주소 고정 대응이다
export const ROUTER_NAT_COMMANDS: readonly CommandDefinition[] = ([false, true] as const).map(remove =>
  defineCommand({
    modes: ["config"], devices: ["router"],
    tokens: [...(remove ? ["no"] : []), "ip", "nat", "inside", "source", "static",
      param("insideIp", "ipv4", "Inside local IPv4 address"), param("outsideIp", "ipv4", "Inside global IPv4 address")],
    help: remove ? "Remove a static NAT mapping" : "Map an inside address to a fixed outside address",
    run: (args, context) => ({ lines: linesFromDispatch(context.dispatch({
      type: "router/set-static-nat", deviceId: context.device.id,
      insideIp: String(args.insideIp), outsideIp: remove ? null : String(args.outsideIp),
    })) }),
  }));
