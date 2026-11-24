// reducer: 동적 NAT·overload의 설정 명령 (T16.3).
// `router/set-nat-pool` — `ip nat pool <name> <start> <end> netmask <mask>`의 주소 범위
// `router/set-access-list`·`router/remove-access-list` — `access-list <1-99> permit|deny <net> <wildcard>`
// `router/set-nat-source`·`router/remove-nat-source` — `ip nat inside source list <acl> pool|interface <대상> [overload]`

import { checkHostIpv4, checkIpv4, checkMask, errorInfo, networkAddress, parseIpv4 } from "@ping9/shared";
import type { NatSourceRule } from "@ping9/shared";

import type { CommandHandler } from "../reducer";
import { checkRouterPort, findRouter, withRouterConfig } from "./router-common";

const ACL_ID_MIN = 1;
const ACL_ID_MAX = 99;

function checkListId(listId: number) {
  return Number.isInteger(listId) && listId >= ACL_ID_MIN && listId <= ACL_ID_MAX
    ? null
    : errorInfo("ACCESS_LIST_ID_INVALID", { listId });
}

export const setNatPool: CommandHandler<"router/set-nat-pool"> = (document, command) => {
  const found = findRouter(document, command.deviceId);
  if (!found.ok) return found;
  const { device } = found;
  const pools = device.config.natPools ?? [];
  const existing = pools.find(pool => pool.name === command.name);
  const inUse = (device.config.natSources ?? []).some(rule => rule.pool === command.name);
  if (command.startIp === null) {
    if (existing === undefined) return { ok: false, error: errorInfo("NAT_POOL_NOT_FOUND", { name: command.name }) };
    if (inUse) return { ok: false, error: errorInfo("NAT_POOL_IN_USE", { name: command.name }) };
    return withRouterConfig(document, device, { ...device.config, natPools: pools.filter(pool => pool !== existing) });
  }
  // 쓰는 중인 풀의 범위도 바꿀 수 없다 — 바인딩이 엉키지 않게 실제 IOS처럼 거절한다
  if (inUse) return { ok: false, error: errorInfo("NAT_POOL_IN_USE", { name: command.name }) };
  if (command.endIp === null || command.netmask === null) {
    return { ok: false, error: errorInfo("NAT_POOL_INVALID", { name: command.name }) };
  }
  const bad = checkHostIpv4(command.startIp) ?? checkHostIpv4(command.endIp) ?? checkMask(command.netmask);
  if (bad !== null) return { ok: false, error: bad };
  const start = parseIpv4(command.startIp)!;
  const end = parseIpv4(command.endIp)!;
  if (start >= end || networkAddress(command.startIp, command.netmask) !== networkAddress(command.endIp, command.netmask)) {
    return { ok: false, error: errorInfo("NAT_POOL_INVALID", { name: command.name }) };
  }
  const entry = { name: command.name, startIp: command.startIp, endIp: command.endIp, netmask: command.netmask };
  const natPools = existing === undefined ? [...pools, entry] : pools.map(pool => pool === existing ? entry : pool);
  return withRouterConfig(document, device, { ...device.config, natPools });
};

export const setAccessList: CommandHandler<"router/set-access-list"> = (document, command) => {
  const found = findRouter(document, command.deviceId);
  if (!found.ok) return found;
  const { device } = found;
  const idError = checkListId(command.listId);
  if (idError !== null) return { ok: false, error: idError };
  const bad = checkIpv4(command.network) ?? checkIpv4(command.wildcard);
  if (bad !== null) return { ok: false, error: bad };
  const lists = device.config.accessLists ?? [];
  const entry = { listId: command.listId, action: command.action, network: command.network, wildcard: command.wildcard };
  // 이미 있는 줄은 다시 넣지 않는다 — IOS도 완전히 같은 줄은 한 번만 남긴다
  if (lists.some(candidate => candidate.listId === entry.listId && candidate.action === entry.action
    && candidate.network === entry.network && candidate.wildcard === entry.wildcard)) {
    return { ok: true, document, notices: [] };
  }
  return withRouterConfig(document, device, { ...device.config, accessLists: [...lists, entry] });
};

export const removeAccessList: CommandHandler<"router/remove-access-list"> = (document, command) => {
  const found = findRouter(document, command.deviceId);
  if (!found.ok) return found;
  const { device } = found;
  const idError = checkListId(command.listId);
  if (idError !== null) return { ok: false, error: idError };
  const lists = device.config.accessLists ?? [];
  const remaining = command.action === undefined
    ? lists.filter(entry => entry.listId !== command.listId)
    : lists.filter(entry => !(entry.listId === command.listId && entry.action === command.action
      && entry.network === command.network && entry.wildcard === command.wildcard));
  if (remaining.length === lists.length) {
    return { ok: false, error: errorInfo("ACCESS_LIST_NOT_FOUND", { listId: command.listId }) };
  }
  return withRouterConfig(document, device, { ...device.config, accessLists: remaining });
};

/** 매칭 필드와 대상 필드가 같은 규칙인지 — 추가시 대체·삭제시 식별에 쓴다 */
function sameRule(rule: NatSourceRule, command: {
  listId: number | null; network: string | null; wildcard: string | null;
  pool: string | null; poolStart: string | null; poolEnd: string | null; interface: string | null;
}): boolean {
  return (rule.listId ?? null) === command.listId
    && (rule.network ?? null) === command.network && (rule.wildcard ?? null) === command.wildcard
    && (rule.pool ?? null) === command.pool && (rule.poolStart ?? null) === command.poolStart
    && (rule.poolEnd ?? null) === command.poolEnd && (rule.interface ?? null) === command.interface;
}

export const setNatSource: CommandHandler<"router/set-nat-source"> = (document, command) => {
  const found = findRouter(document, command.deviceId);
  if (!found.ok) return found;
  const { device } = found;
  const invalid = errorInfo("NAT_SOURCE_INVALID", { listId: command.listId ?? 0 });
  if ((command.listId === null) === (command.network === null)) return { ok: false, error: invalid };
  if (command.listId !== null) {
    const idError = checkListId(command.listId);
    if (idError !== null) return { ok: false, error: idError };
  } else {
    const bad = checkIpv4(command.network!) ?? (command.wildcard === null ? null : checkIpv4(command.wildcard));
    if (bad !== null) return { ok: false, error: bad };
  }
  const targets = [command.pool !== null, command.poolStart !== null, command.interface !== null].filter(Boolean).length;
  if (targets !== 1) return { ok: false, error: invalid };
  if (command.pool !== null && !(device.config.natPools ?? []).some(pool => pool.name === command.pool)) {
    return { ok: false, error: errorInfo("NAT_POOL_NOT_FOUND", { name: command.pool }) };
  }
  if (command.poolStart !== null) {
    const bad = checkHostIpv4(command.poolStart) ?? (command.poolEnd === null ? null : checkHostIpv4(command.poolEnd));
    if (bad !== null) return { ok: false, error: bad };
    if (command.poolEnd !== null && parseIpv4(command.poolStart)! > parseIpv4(command.poolEnd)!) {
      return { ok: false, error: errorInfo("NAT_POOL_INVALID", { name: `${command.poolStart}-${command.poolEnd}` }) };
    }
  }
  if (command.interface !== null) {
    const portError = checkRouterPort(device, command.interface);
    if (portError !== null) return { ok: false, error: portError };
  }
  const rules = device.config.natSources ?? [];
  const entry: NatSourceRule = {
    overload: command.overload,
    ...(command.listId === null ? { network: command.network!, ...(command.wildcard === null ? {} : { wildcard: command.wildcard }) }
      : { listId: command.listId }),
    ...(command.pool !== null ? { pool: command.pool }
      : command.poolStart !== null
        ? { poolStart: command.poolStart, ...(command.poolEnd === null ? {} : { poolEnd: command.poolEnd }) }
        : { interface: command.interface! }),
  };
  const existing = rules.find(rule => sameRule(rule, command));
  const natSources = existing === undefined ? [...rules, entry] : rules.map(rule => rule === existing ? entry : rule);
  return withRouterConfig(document, device, { ...device.config, natSources });
};

export const removeNatSource: CommandHandler<"router/remove-nat-source"> = (document, command) => {
  const found = findRouter(document, command.deviceId);
  if (!found.ok) return found;
  const { device } = found;
  const rules = device.config.natSources ?? [];
  const remaining = rules.filter(rule => !sameRule(rule, command));
  if (remaining.length === rules.length) {
    return { ok: false, error: errorInfo("NAT_SOURCE_NOT_FOUND", { listId: command.listId ?? 0 }) };
  }
  return withRouterConfig(document, device, { ...device.config, natSources: remaining });
};
