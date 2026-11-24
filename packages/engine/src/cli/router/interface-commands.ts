import { defineCommand, linesFromDispatch, param } from "../ios";
import type { CommandDefinition } from "../ios";

export const ROUTER_INTERFACE_COMMANDS: readonly CommandDefinition[] = [
  defineCommand({
    modes: ["config-if"], devices: ["router"],
    tokens: ["ip", "address", param("ip", "ipv4", "Interface IPv4 address"), param("mask", "mask", "Subnet mask")],
    help: "Set the interface IPv4 address and subnet mask",
    run: (args, context) => {
      const port = context.session.targetPort;
      if (port === undefined) return {};
      return { lines: linesFromDispatch(context.dispatch({
        type: "interface/set-ip", deviceId: context.device.id, port, ip: String(args.ip), mask: String(args.mask),
      })) };
    },
  }),
  defineCommand({
    modes: ["config-if"], devices: ["router"],
    tokens: ["ip", "nat", param("role", "word", "NAT role (inside|outside)")],
    help: "Mark the interface as NAT inside or outside",
    run: (args, context) => {
      const port = context.session.targetPort;
      if (port === undefined) return {};
      return { lines: linesFromDispatch(context.dispatch({
        type: "interface/set-nat", deviceId: context.device.id, port, nat: String(args.role) as "inside" | "outside",
      })) };
    },
  }),
  defineCommand({
    modes: ["config-if"], devices: ["router"],
    tokens: ["no", "ip", "nat", param("role", "word", "NAT role (inside|outside)")],
    help: "Remove the NAT role from the interface",
    run: (_args, context) => {
      const port = context.session.targetPort;
      if (port === undefined) return {};
      return { lines: linesFromDispatch(context.dispatch({
        type: "interface/set-nat", deviceId: context.device.id, port, nat: null,
      })) };
    },
  }),
  defineCommand({
    modes: ["config-if"], devices: ["router"], tokens: ["no", "ip", "address"],
    help: "Remove the interface IPv4 address",
    run: (_args, context) => {
      const port = context.session.targetPort;
      if (port === undefined) return {};
      return { lines: linesFromDispatch(context.dispatch({ type: "interface/clear-ip", deviceId: context.device.id, port })) };
    },
  }),
];
