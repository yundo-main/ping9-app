// L3 Switch의 명령 정의 목록 (T0.33). 스위치의 VLAN·switchport 명령에
// SVI(`interface vlan`)·라우티드 포트(`no switchport`)·`ip routing`·`ip route`·RIP를 얹는다.

import { errorInfo } from "@ping9/shared";

import { computeViews } from "../../views";
import { BASE_COMMANDS, customParam, defineCommand, INTERFACE_COMMANDS, linesFromDispatch, param } from "../ios";
import type { CommandDefinition, ParamValue } from "../ios";
import { ripCommands } from "../router/rip-commands";
import { routeCommands } from "../router/route-commands";
import { routeTableLines, routesOf } from "../router/show-commands";
import { SHOW_COMMANDS } from "../switch/show-commands";
import { SWITCHPORT_COMMANDS } from "../switch/switchport-commands";
import { VLAN_COMMANDS } from "../switch/vlan-commands";

const VLAN_ID = customParam("id", "VLAN identifier (1-4094)", (text): ParamValue =>
  /^\d{1,4}$/.test(text) ? { ok: true, value: Number(text) } : invalid(text));
const invalid = (token: string): ParamValue => ({ ok: false, error: errorInfo("CLI_INVALID_VALUE", { token: token.slice(0, 64) }) });

const l3 = (definition: Omit<CommandDefinition, "devices">): CommandDefinition =>
  defineCommand({ ...definition, devices: ["l3switch"] });

const L3_COMMANDS: readonly CommandDefinition[] = [
  // `interface vlan <id>` — SVI를 만들고 config-if로 들어간다
  l3({
    modes: ["config"],
    tokens: ["interface", "vlan", VLAN_ID],
    help: "Create or enter the SVI for a VLAN",
    run: (args, context) => {
      const result = context.dispatch({ type: "l3switch/svi", deviceId: context.device.id, vlan: Number(args.id) });
      return result.ok ? { session: { mode: "config-if", targetPort: `Vlan${Number(args.id)}` } }
        : { lines: linesFromDispatch(result) };
    },
  }),
  l3({
    modes: ["config"],
    tokens: ["no", "interface", "vlan", VLAN_ID],
    help: "Remove the SVI for a VLAN",
    run: (args, context) => ({
      lines: linesFromDispatch(context.dispatch({
        type: "l3switch/remove-svi", deviceId: context.device.id, name: `Vlan${Number(args.id)}`,
      })),
    }),
  }),
  // `no switchport` — 물리 포트를 라우티드 포트로. `switchport`는 L2로 되돌린다
  l3({
    modes: ["config-if"],
    tokens: ["no", "switchport"],
    help: "Make this a routed (Layer 3) port",
    run: (_args, context) => context.session.targetPort === undefined ? {} : {
      lines: linesFromDispatch(context.dispatch({
        type: "l3switch/set-routed", deviceId: context.device.id, port: context.session.targetPort, routed: true,
      })),
    },
  }),
  l3({
    modes: ["config-if"],
    tokens: ["switchport"],
    help: "Return this port to Layer 2 switching",
    run: (_args, context) => context.session.targetPort === undefined ? {} : {
      lines: linesFromDispatch(context.dispatch({
        type: "l3switch/set-routed", deviceId: context.device.id, port: context.session.targetPort, routed: false,
      })),
    },
  }),
  // SVI·라우티드 포트의 IP
  l3({
    modes: ["config-if"],
    tokens: ["ip", "address", param("ip", "ipv4", "Interface IPv4 address"), param("mask", "mask", "Subnet mask")],
    help: "Set the interface IPv4 address and subnet mask",
    run: (args, context) => context.session.targetPort === undefined ? {} : {
      lines: linesFromDispatch(context.dispatch({
        type: "interface/set-ip", deviceId: context.device.id, port: context.session.targetPort,
        ip: String(args.ip), mask: String(args.mask),
      })),
    },
  }),
  l3({
    modes: ["config-if"],
    tokens: ["no", "ip", "address"],
    help: "Remove the interface IPv4 address",
    run: (_args, context) => context.session.targetPort === undefined ? {} : {
      lines: linesFromDispatch(context.dispatch({
        type: "interface/clear-ip", deviceId: context.device.id, port: context.session.targetPort,
      })),
    },
  }),
  // `ip routing` — L3 전달 켜기
  l3({
    modes: ["config"],
    tokens: ["ip", "routing"],
    help: "Enable IP routing between interfaces",
    run: (_args, context) => ({
      lines: linesFromDispatch(context.dispatch({ type: "l3switch/set-ip-routing", deviceId: context.device.id, enabled: true })),
    }),
  }),
  l3({
    modes: ["config"],
    tokens: ["no", "ip", "routing"],
    help: "Disable IP routing",
    run: (_args, context) => ({
      lines: linesFromDispatch(context.dispatch({ type: "l3switch/set-ip-routing", deviceId: context.device.id, enabled: false })),
    }),
  }),
  // 조회
  l3({
    modes: ["privileged"], tokens: ["show", "ip", "route"],
    help: "Show the routing table",
    run: (_args, context) => context.device.kind === "l3switch"
      ? { lines: routeTableLines(routesOf(context)).map(text => ({ kind: "text" as const, text })) }
      : {},
  }),
  ...(["rip", "connected", "static"] as const).map(source => l3({
    modes: ["privileged"], tokens: ["show", "ip", "route", source],
    help: `Show only ${source === "rip" ? "RIP" : source} routes`,
    run: (_args, context) => context.device.kind === "l3switch"
      ? { lines: routeTableLines(routesOf(context).filter(route => route.source === source)).map(text => ({ kind: "text" as const, text })) }
      : {},
  })),
  l3({
    modes: ["privileged"], tokens: ["show", "ip", "interface", "brief"],
    help: "Show interface status and IP addresses",
    run: (_args, context) => {
      if (context.device.kind !== "l3switch") return {};
      const view = computeViews(context.document)[context.device.id];
      if (view?.kind !== "l3switch") return {};
      const width = Math.max(...view.interfaces.map(iface => iface.name.length), 9);
      const lines = view.interfaces.map(iface =>
        `${iface.name.padEnd(width)} ${(iface.ip ?? "unassigned").padEnd(15)} ${iface.status}`);
      return { lines: lines.map(text => ({ kind: "text" as const, text })) };
    },
  }),
];

export const L3SWITCH_COMMANDS: readonly CommandDefinition[] = [
  ...BASE_COMMANDS,
  ...INTERFACE_COMMANDS,
  ...VLAN_COMMANDS,
  ...SWITCHPORT_COMMANDS,
  ...SHOW_COMMANDS,
  ...L3_COMMANDS,
  ...routeCommands(["l3switch"]),
  ...ripCommands(["l3switch"]),
];
