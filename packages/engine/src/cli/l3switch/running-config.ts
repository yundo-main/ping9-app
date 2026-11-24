// `show running-config`의 L3 Switch 출력 (T0.33). 스위치의 L2 부분에
// 라우티드 포트·SVI·ip route·RIP를 덧붙인다. 출력을 콘솔에 그대로 치면 같은 구성이 된다.

import { DEFAULT_VLAN_ID, defaultVlanName, isSviName, switchPorts, switchVlans } from "@ping9/shared";
import type { L3SwitchDevice, VlanRange } from "@ping9/shared";

import { formatVlanList } from "../switch/vlan-list";

const SEPARATOR = "!";
const RANGES_PER_LINE = 16;

function allowedVlanLines(ranges: readonly VlanRange[]): string[] {
  const all = formatVlanList(ranges);
  if (all === "all") return [];
  const lines: string[] = [];
  for (let start = 0; start < Math.max(ranges.length, 1); start += RANGES_PER_LINE) {
    const list = formatVlanList(ranges.slice(start, start + RANGES_PER_LINE));
    lines.push(` switchport trunk allowed vlan ${start === 0 ? "" : "add "}${list}`);
  }
  return lines;
}

export function l3RunningConfigLines(device: L3SwitchDevice): string[] {
  const lines = [`hostname ${device.name}`, SEPARATOR];
  if (device.config.ipRouting === true) lines.push("ip routing", SEPARATOR);

  for (const vlan of switchVlans(device.config)) {
    if (vlan.id === DEFAULT_VLAN_ID) continue;
    lines.push(`vlan ${vlan.id}`);
    if (vlan.name !== defaultVlanName(vlan.id)) lines.push(` name ${vlan.name}`);
    lines.push(SEPARATOR);
  }

  const interfaces = device.config.interfaces;
  for (const port of switchPorts(device.config)) {
    const routed = device.config.ports[port.name]?.routed === true;
    const iface = interfaces[port.name];
    const settings: string[] = [];
    if (routed) settings.push(" no switchport");
    if (!routed && port.mode === "trunk") settings.push(" switchport mode trunk");
    if (!routed && port.accessVlan !== DEFAULT_VLAN_ID) settings.push(` switchport access vlan ${port.accessVlan}`);
    if (!routed) settings.push(...allowedVlanLines(port.allowedVlans));
    if (iface?.ip !== undefined && iface.mask !== undefined) settings.push(` ip address ${iface.ip} ${iface.mask}`);
    if (!port.adminUp || iface?.adminUp === false) settings.push(" shutdown");
    if (settings.length > 0) lines.push(`interface ${port.name}`, ...settings, SEPARATOR);
  }

  for (const name of Object.keys(interfaces).filter(isSviName).sort()) {
    const iface = interfaces[name]!;
    lines.push(`interface ${name}`);
    if (iface.ip !== undefined && iface.mask !== undefined) lines.push(` ip address ${iface.ip} ${iface.mask}`);
    if (!iface.adminUp) lines.push(" shutdown");
    lines.push(SEPARATOR);
  }

  const rip = device.config.rip;
  if (rip !== undefined) {
    lines.push("router rip");
    for (const network of rip.networks) lines.push(` network ${network}`);
    for (const port of rip.passiveInterfaces) lines.push(` passive-interface ${port}`);
    lines.push(SEPARATOR);
  }

  for (const route of device.config.staticRoutes) {
    const distance = route.distance === undefined || route.distance === 1 ? "" : ` ${route.distance}`;
    lines.push(`ip route ${route.network} ${route.mask} ${route.nextHop}${distance}`);
  }
  if (device.config.staticRoutes.length > 0) lines.push(SEPARATOR);

  lines.push("end");
  return lines;
}
