import { defineCommand, linesFromDispatch, param, resolvePortName } from "../ios";
import type { CommandDefinition } from "../ios";

// `ip nat inside source static <inside> <outside>`·`no ...` (T16.2). 1:1 호스트 주소 고정 대응이다
const STATIC_COMMANDS: readonly CommandDefinition[] = ([false, true] as const).map(remove =>
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

// `ip nat pool <name> <start> <end> netmask <mask>`·`no ip nat pool <name>` (T16.3). 변환에 쓸 바깥 주소 범위
const POOL_COMMANDS: readonly CommandDefinition[] = [
  defineCommand({
    modes: ["config"], devices: ["router"],
    tokens: ["ip", "nat", "pool", param("name", "word", "Pool name"),
      param("startIp", "ipv4", "First address"), param("endIp", "ipv4", "Last address"),
      "netmask", param("netmask", "mask", "Pool subnet mask")],
    help: "Define a pool of global addresses for dynamic NAT",
    run: (args, context) => ({ lines: linesFromDispatch(context.dispatch({
      type: "router/set-nat-pool", deviceId: context.device.id, name: String(args.name),
      startIp: String(args.startIp), endIp: String(args.endIp), netmask: String(args.netmask),
    })) }),
  }),
  defineCommand({
    modes: ["config"], devices: ["router"],
    tokens: ["no", "ip", "nat", "pool", param("name", "word", "Pool name")],
    help: "Remove a NAT address pool",
    run: (args, context) => ({ lines: linesFromDispatch(context.dispatch({
      type: "router/set-nat-pool", deviceId: context.device.id, name: String(args.name),
      startIp: null, endIp: null, netmask: null,
    })) }),
  }),
];

// `ip nat inside source list <acl> pool <name> [overload]`·`... interface <iface> overload`·`no ...` (T16.3).
// overload 없는 pool 규칙은 주소 하나씩 대응하는 동적 NAT, overload은 포트로 나눠 쓰는 PAT다
const SOURCE_COMMANDS: readonly CommandDefinition[] = ([false, true] as const).flatMap(remove => [
  ...([false, true] as const).map(overload => defineCommand({
    modes: ["config"], devices: ["router"],
    tokens: [...(remove ? ["no"] : []), "ip", "nat", "inside", "source", "list",
      param("listId", "word", "Standard access-list number (1-99)"), "pool", param("pool", "word", "NAT pool name"),
      ...(overload ? ["overload"] : [])],
    help: remove ? "Remove a pool-based NAT rule"
      : overload ? "Translate inside addresses to pool addresses with port multiplexing (PAT)"
        : "Translate inside addresses to pool addresses one-to-one (dynamic NAT)",
    run: (args, context) => ({ lines: linesFromDispatch(context.dispatch(remove
      ? { type: "router/remove-nat-source", deviceId: context.device.id,
          listId: Number(args.listId), network: null, wildcard: null,
          pool: String(args.pool), poolStart: null, poolEnd: null, interface: null }
      : { type: "router/set-nat-source", deviceId: context.device.id,
          listId: Number(args.listId), network: null, wildcard: null,
          pool: String(args.pool), poolStart: null, poolEnd: null, interface: null, overload })) }),
  })),
  defineCommand({
    modes: ["config"], devices: ["router"],
    tokens: [...(remove ? ["no"] : []), "ip", "nat", "inside", "source", "list",
      param("listId", "word", "Standard access-list number (1-99)"), "interface", param("interface", "word", "Outside interface (Gi0/1)"),
      ...(remove ? [] : ["overload"])],
    help: remove ? "Remove an interface-based NAT rule" : "Translate inside addresses to the interface address with port multiplexing (PAT)",
    run: (args, context) => {
      const port = resolvePortName("router", String(args.interface)) ?? String(args.interface);
      return { lines: linesFromDispatch(context.dispatch(remove
        ? { type: "router/remove-nat-source", deviceId: context.device.id,
            listId: Number(args.listId), network: null, wildcard: null,
            pool: null, poolStart: null, poolEnd: null, interface: port }
        : { type: "router/set-nat-source", deviceId: context.device.id,
            listId: Number(args.listId), network: null, wildcard: null,
            pool: null, poolStart: null, poolEnd: null, interface: port, overload: true })) };
    },
  }),
]);

// `access-list <1-99> permit|deny <net> <wildcard>`·`any`·`host <ip>`·`no ...` (T16.3). 표준 번호 ACL이다
const ACL_COMMANDS: readonly CommandDefinition[] = (["permit", "deny"] as const).flatMap(action => [
  defineCommand({
    modes: ["config"], devices: ["router"],
    tokens: ["access-list", param("listId", "word", "Standard access-list number (1-99)"), action,
      param("network", "ipv4", "Source network"), param("wildcard", "ipv4", "Wildcard mask")],
    help: `${action === "permit" ? "Match" : "Exclude"} a source range in a standard access list`,
    run: (args, context) => ({ lines: linesFromDispatch(context.dispatch({
      type: "router/set-access-list", deviceId: context.device.id, listId: Number(args.listId), action,
      network: String(args.network), wildcard: String(args.wildcard),
    })) }),
  }),
  defineCommand({
    modes: ["config"], devices: ["router"],
    tokens: ["access-list", param("listId", "word", "Standard access-list number (1-99)"), action, "any"],
    help: `${action === "permit" ? "Match" : "Exclude"} every source in a standard access list`,
    run: (args, context) => ({ lines: linesFromDispatch(context.dispatch({
      type: "router/set-access-list", deviceId: context.device.id, listId: Number(args.listId), action,
      network: "0.0.0.0", wildcard: "255.255.255.255",
    })) }),
  }),
  defineCommand({
    modes: ["config"], devices: ["router"],
    tokens: ["access-list", param("listId", "word", "Standard access-list number (1-99)"), action,
      "host", param("host", "ipv4", "Single source address")],
    help: `${action === "permit" ? "Match" : "Exclude"} one source address in a standard access list`,
    run: (args, context) => ({ lines: linesFromDispatch(context.dispatch({
      type: "router/set-access-list", deviceId: context.device.id, listId: Number(args.listId), action,
      network: String(args.host), wildcard: "0.0.0.0",
    })) }),
  }),
]);

const ACL_REMOVE_COMMANDS: readonly CommandDefinition[] = [
  defineCommand({
    modes: ["config"], devices: ["router"],
    tokens: ["no", "access-list", param("listId", "word", "Standard access-list number (1-99)")],
    help: "Remove a whole standard access list",
    run: (args, context) => ({ lines: linesFromDispatch(context.dispatch({
      type: "router/remove-access-list", deviceId: context.device.id, listId: Number(args.listId),
    })) }),
  }),
  defineCommand({
    modes: ["config"], devices: ["router"],
    tokens: ["no", "access-list", param("listId", "word", "Standard access-list number (1-99)"),
      param("action", "word", "permit|deny"),
      param("network", "ipv4", "Source network"), param("wildcard", "ipv4", "Wildcard mask")],
    help: "Remove one entry from a standard access list",
    run: (args, context) => ({ lines: linesFromDispatch(context.dispatch({
      type: "router/remove-access-list", deviceId: context.device.id, listId: Number(args.listId),
      action: args.action === "deny" ? "deny" : "permit",
      network: String(args.network), wildcard: String(args.wildcard),
    })) }),
  }),
];

export const ROUTER_NAT_COMMANDS: readonly CommandDefinition[] = [
  ...STATIC_COMMANDS, ...POOL_COMMANDS, ...SOURCE_COMMANDS, ...ACL_COMMANDS, ...ACL_REMOVE_COMMANDS,
];
