import { IPSEC_DEFAULT_POLICY, PORT_NAMES, checkHostIpv4, checkIpv4, checkMask, formatIpv4, isIpsecName, maskToPrefixLength, networkAddress, parseIpv4, prefixLengthToMask } from "@ping9/shared";
import type { GreTunnelConfig, IpsecProfileConfig, NatSourceRule, NatStaticEntry, RouterConfig, RouterInterfaceConfig, StaticRoute } from "@ping9/shared";

export type Settings = Readonly<Record<string, string>>;
const NAME = "[A-Za-z0-9_-]{1,32}";
export const RULES: readonly { pattern: RegExp; flag: boolean; sample: string }[] = [
  { pattern: /^interfaces (?:tunnel tun[0-3]|ethernet eth[0-3]) address \S+$/, flag: true, sample: "interfaces tunnel tun0 address <IPv4/prefix>" },
  { pattern: /^interfaces (?:tunnel tun[0-3]|ethernet eth[0-3]) disable$/, flag: true, sample: "interfaces tunnel tun0 disable" },
  { pattern: /^interfaces tunnel tun[0-3] (?:encapsulation|source-address|remote) \S+$/, flag: false, sample: "interfaces tunnel tun0 encapsulation gre" },
  { pattern: /^protocols static route \S+ next-hop \S+$/, flag: true, sample: "protocols static route <prefix> next-hop <IPv4>" },
  { pattern: /^nat source rule [0-9]{1,3} outbound-interface eth[0-3]$/, flag: false, sample: "nat source rule 10 outbound-interface eth1" },
  { pattern: /^nat source rule [0-9]{1,3} source address \S+$/, flag: false, sample: "nat source rule 100 source address 192.168.1.10" },
  { pattern: /^nat source rule [0-9]{1,3} translation address \S+$/, flag: false, sample: "nat source rule 10 translation address masquerade" },
  { pattern: /^nat source rule [0-9]{1,3} translation port \S+$/, flag: false, sample: "nat source rule 10 translation port 1-65535" },
  { pattern: /^nat destination rule [0-9]{1,3} inbound-interface eth[0-3]$/, flag: false, sample: "nat destination rule 100 inbound-interface eth1" },
  { pattern: /^nat destination rule [0-9]{1,3} destination address \S+$/, flag: false, sample: "nat destination rule 100 destination address 10.0.12.1" },
  { pattern: /^nat destination rule [0-9]{1,3} translation address \S+$/, flag: false, sample: "nat destination rule 100 translation address 192.168.1.10" },
  { pattern: /^vpn ipsec interface eth[0-3]$/, flag: true, sample: "vpn ipsec interface eth1" },
  { pattern: new RegExp(`^vpn ipsec authentication psk ${NAME} id \\S+$`), flag: true, sample: "vpn ipsec authentication psk LAB id <peer-id>" },
  { pattern: new RegExp(`^vpn ipsec authentication psk ${NAME} secret \\S+$`), flag: false, sample: "vpn ipsec authentication psk LAB secret <lab-secret>" },
  { pattern: new RegExp(`^vpn ipsec ike-group ${NAME} (?:key-exchange|lifetime) \\S+$`), flag: false, sample: "vpn ipsec ike-group IKE key-exchange ikev2" },
  { pattern: new RegExp(`^vpn ipsec ike-group ${NAME} proposal 10 (?:encryption|hash|dh-group) \\S+$`), flag: false, sample: "vpn ipsec ike-group IKE proposal 10 encryption aes256" },
  { pattern: new RegExp(`^vpn ipsec esp-group ${NAME} (?:mode|lifetime|pfs) \\S+$`), flag: false, sample: "vpn ipsec esp-group ESP mode tunnel" },
  { pattern: new RegExp(`^vpn ipsec esp-group ${NAME} proposal 10 (?:encryption|hash) \\S+$`), flag: false, sample: "vpn ipsec esp-group ESP proposal 10 encryption aes256" },
  { pattern: new RegExp(`^vpn ipsec site-to-site peer ${NAME} (?:local-address|remote-address|ike-group|default-esp-group) \\S+$`), flag: false, sample: "vpn ipsec site-to-site peer R2 remote-address <IPv4>" },
  { pattern: new RegExp(`^vpn ipsec site-to-site peer ${NAME} authentication (?:mode|local-id|remote-id) \\S+$`), flag: false, sample: "vpn ipsec site-to-site peer R2 authentication mode pre-shared-secret" },
  { pattern: new RegExp(`^vpn ipsec site-to-site peer ${NAME} tunnel 0 (?:local|remote) prefix \\S+$`), flag: false, sample: "vpn ipsec site-to-site peer R2 tunnel 0 local prefix <subnet>" },
  { pattern: new RegExp(`^vpn ipsec site-to-site peer ${NAME} tunnel 0 disable$`), flag: true, sample: "vpn ipsec site-to-site peer R2 tunnel 0 disable" },
  { pattern: /^service ssh$/, flag: true, sample: "service ssh" },
  { pattern: /^service ssh disable$/, flag: true, sample: "service ssh disable" },
  { pattern: new RegExp(`^system login user ${NAME} authentication plaintext-password \\S+$`), flag: false, sample: "system login user <name> authentication plaintext-password <pw>" },
];
const ensure = (ok: unknown, message: string): void => { if (!ok) throw new Error(message); };
export const physicalPort = (eth: string): string => PORT_NAMES.router[Number(eth.slice(3))]!;
export const tunnelPort = (tun: string): string => `Tunnel${tun.slice(3)}`;
export const cidr = (ip: string, mask: string): string => `${ip}/${maskToPrefixLength(mask)}`;
export function subnet(value: string) {
  const [network, prefix, extra] = value.split("/");
  ensure(extra === undefined && network !== undefined && /^\d{1,2}$/.test(prefix ?? ""), `IPv4/prefix 값이 필요합니다: ${value}`);
  const mask = prefixLengthToMask(Number(prefix));
  ensure(mask !== null && checkIpv4(network!) === null && checkMask(mask) === null, `잘못된 prefix: ${value}`);
  return { network: network!, mask: mask! };
}
function duration(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  ensure(/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 86400, "lifetime은 1~86400초입니다");
  return Number(value);
}
function names(settings: Settings, prefix: string): string[] {
  return [...new Set(Object.keys(settings).filter(key => key.startsWith(`${prefix} `)).map(key => key.slice(prefix.length + 1).split(" ")[0]!))].sort();
}
function spi(source: string, target: string): number {
  // 교육용 결정적 식별 번호이며 암호학적 함수나 실제 IKE가 아니다.
  let hash = 2166136261;
  for (const ch of `${source}>${target}`) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  return 256 + hash % (0xffffffff - 255);
}
export function settingsOf(config: RouterConfig): Settings {
  if (config.vyos !== undefined) return { ...config.vyos };
  const result: Record<string, string> = {};
  const ssh = config.ssh;
  if (ssh !== undefined) {
    if (ssh.enabled !== false) result["service ssh"] = "";
    if (ssh.enabled === false) result["service ssh disable"] = "";
    for (const account of ssh.users) result[`system login user ${account.user} authentication plaintext-password`] = account.password;
  }
  for (const [index, port] of PORT_NAMES.router.entries()) {
    const iface = config.interfaces[port];
    if (iface?.ip !== undefined) result[`interfaces ethernet eth${index} address ${cidr(iface.ip, iface.mask!)}`] = "";
    if (!iface?.adminUp) result[`interfaces ethernet eth${index} disable`] = "";
  }
  for (const [name, tunnel] of Object.entries(config.tunnels ?? {})) {
    const root = `interfaces tunnel tun${name.slice(6)}`;
    result[`${root} encapsulation`] = "gre";
    if (tunnel.ip !== undefined) result[`${root} address ${cidr(tunnel.ip, tunnel.mask!)}`] = "";
    if (tunnel.source !== undefined && config.interfaces[tunnel.source]?.ip !== undefined) result[`${root} source-address`] = config.interfaces[tunnel.source]!.ip!;
    if (tunnel.destination !== undefined) result[`${root} remote`] = tunnel.destination;
    if (!tunnel.adminUp) result[`${root} disable`] = "";
  }
  for (const [index, port] of PORT_NAMES.router.entries()) {
    if (config.interfaces[port]?.nat === "outside") {
      result[`nat source rule ${(index + 1) * 10} outbound-interface`] = `eth${index}`;
      result[`nat source rule ${(index + 1) * 10} translation address`] = "masquerade";
    }
  }
  // 정적 대응은 DNAT(source rule이 아니라 destination rule)와 SNAT 두 규칙으로 나타낸다 (T16.2)
  for (const [index, entry] of (config.natStatics ?? []).entries()) {
    const match = PORT_NAMES.router.findIndex(p => config.interfaces[p]?.nat === "outside" && config.interfaces[p]?.ip === entry.outsideIp);
    const eth = match >= 0 ? match : PORT_NAMES.router.findIndex(p => config.interfaces[p]?.nat === "outside");
    if (eth < 0) continue; // outside 인터페이스가 없으면 규칙을 표현할 수 없다
    const rule = 100 + index * 10;
    result[`nat destination rule ${rule} inbound-interface`] = `eth${eth}`;
    result[`nat destination rule ${rule} destination address`] = entry.outsideIp;
    result[`nat destination rule ${rule} translation address`] = entry.insideIp;
    result[`nat source rule ${rule} outbound-interface`] = `eth${eth}`;
    result[`nat source rule ${rule} source address`] = entry.insideIp;
    result[`nat source rule ${rule} translation address`] = entry.outsideIp;
  }
  // 동적 NAT 규칙 (T16.3): 풀은 `translation address a-b`, 인터페이스 overload은 masquerade + source address
  for (const [index, rule] of (config.natSources ?? []).entries()) {
    const ruleNo = 500 + index * 10;
    const eth = rule.interface !== undefined ? (PORT_NAMES.router as readonly string[]).indexOf(rule.interface)
      : PORT_NAMES.router.findIndex(p => config.interfaces[p]?.nat === "outside");
    if (eth < 0) continue;
    // 매칭은 ACL의 첫 permit 줄이나 직접 network로 표현한다 — `source address`가 없는 규칙은 내보낼 수 없다
    const acl = rule.listId === undefined ? undefined
      : (config.accessLists ?? []).find(entry => entry.listId === rule.listId && entry.action === "permit");
    const network = rule.network ?? acl?.network;
    const wildcard = rule.wildcard ?? acl?.wildcard;
    const prefix = wildcard === undefined ? undefined
      : maskToPrefixLength(formatIpv4(4294967295 - (parseIpv4(wildcard) ?? 4294967295)));
    if (network === undefined || prefix === undefined) continue;
    const root = `nat source rule ${ruleNo}`;
    result[`${root} outbound-interface`] = `eth${eth}`;
    result[`${root} source address`] = `${network}/${prefix}`;
    if (rule.pool !== undefined || rule.poolStart !== undefined) {
      const pool = rule.poolStart !== undefined ? { startIp: rule.poolStart, endIp: rule.poolEnd ?? rule.poolStart }
        : (config.natPools ?? []).find(candidate => candidate.name === rule.pool);
      if (pool === undefined) continue;
      result[`${root} translation address`] = `${pool.startIp}-${pool.endIp}`;
      if (rule.overload) result[`${root} translation port`] = "1-65535";
    } else {
      result[`${root} translation address`] = "masquerade";
    }
  }
  for (const route of config.staticRoutes) {
    ensure(route.distance === undefined || route.distance === 1, "이 VyOS 지원 범위에서는 AD가 지정된 정적 경로를 변환할 수 없습니다");
    result[`protocols static route ${cidr(route.network, route.mask)} next-hop ${route.nextHop}`] = "";
  }
  for (const [name, profile] of Object.entries(config.ipsec ?? {})) {
    ensure(profile.local !== undefined && profile.remote !== undefined && profile.interface !== undefined && profile.peer !== undefined && profile.keyId !== undefined, "미완성 기존 IPsec 프로필을 먼저 완성하거나 삭제하세요");
    const source = config.interfaces[profile.interface!]?.ip;
    ensure(source !== undefined, "기존 IPsec source 인터페이스에 IP가 필요합니다");
    const policy = JSON.parse(profile.policy ?? IPSEC_DEFAULT_POLICY) as Record<string, string>;
    const index = Object.keys(config.ipsec ?? {}).indexOf(name);
    const ike = `IKE_${index}`, esp = `ESP_${index}`, psk = `PSK_${index}`;
    result[`vpn ipsec interface eth${PORT_NAMES.router.indexOf(profile.interface! as typeof PORT_NAMES.router[number])}`] = "";
    result[`vpn ipsec ike-group ${ike} key-exchange`] = policy.ike!;
    result[`vpn ipsec ike-group ${ike} lifetime`] = "28800";
    for (const [field, value] of [["encryption", policy.ikeEncryption!], ["hash", policy.ikeHash!], ["dh-group", policy.dh!]]) result[`vpn ipsec ike-group ${ike} proposal 10 ${field}`] = value!;
    result[`vpn ipsec esp-group ${esp} mode`] = "tunnel";
    result[`vpn ipsec esp-group ${esp} lifetime`] = String(profile.lifetimeSeconds ?? 3600);
    result[`vpn ipsec esp-group ${esp} pfs`] = policy.pfs!;
    result[`vpn ipsec esp-group ${esp} proposal 10 encryption`] = policy.espEncryption!;
    result[`vpn ipsec esp-group ${esp} proposal 10 hash`] = policy.espHash!;
    result[`vpn ipsec authentication psk ${psk} id ${profile.localId ?? source}`] = "";
    result[`vpn ipsec authentication psk ${psk} id ${profile.remoteId ?? profile.peer}`] = "";
    result[`vpn ipsec authentication psk ${psk} secret`] = profile.keyId!;
    const root = `vpn ipsec site-to-site peer ${name}`;
    result[`${root} local-address`] = source!; result[`${root} remote-address`] = profile.peer!;
    result[`${root} authentication mode`] = "pre-shared-secret";
    if (profile.localId !== undefined) result[`${root} authentication local-id`] = profile.localId;
    if (profile.remoteId !== undefined) result[`${root} authentication remote-id`] = profile.remoteId;
    result[`${root} ike-group`] = ike; result[`${root} default-esp-group`] = esp;
    result[`${root} tunnel 0 local prefix`] = cidr(profile.local!.network, profile.local!.mask);
    result[`${root} tunnel 0 remote prefix`] = cidr(profile.remote!.network, profile.remote!.mask);
    if (!profile.adminUp) result[`${root} tunnel 0 disable`] = "";
  }
  return result;
}

export function compile(settings: Settings, base: RouterConfig): RouterConfig {
  ensure(Object.keys(settings).length <= 512, "설정은 512항목까지입니다");
  for (const [key, value] of Object.entries(settings)) ensure(RULES.some(rule => rule.pattern.test(value === "" ? key : `${key} ${value}`) && rule.flag === (value === "")), `미지원 설정 경로: ${key}`);
  // 참조되지 않은 그룹의 오타도 성공한 설정으로 남기지 않는다.
  for (const [key, value] of Object.entries(settings)) {
    if (/^vpn ipsec ike-group \S+ key-exchange$/.test(key)) ensure(["ikev1", "ikev2"].includes(value), "key-exchange는 ikev1/ikev2입니다");
    if (/^vpn ipsec (?:ike|esp)-group \S+ proposal 10 encryption$/.test(key)) ensure(["aes128", "aes256"].includes(value), "encryption은 aes128/aes256입니다");
    if (/^vpn ipsec (?:ike|esp)-group \S+ proposal 10 hash$/.test(key)) ensure(["sha1", "sha256"].includes(value), "hash는 sha1/sha256입니다");
    if (/^vpn ipsec ike-group \S+ proposal 10 dh-group$/.test(key)) ensure(["14", "19"].includes(value), "dh-group은 14/19입니다");
    if (/^vpn ipsec esp-group \S+ pfs$/.test(key)) ensure(["enable", "disable"].includes(value), "pfs는 enable/disable입니다");
    if (/^vpn ipsec esp-group \S+ mode$/.test(key)) ensure(value === "tunnel", "ESP tunnel mode만 지원합니다");
    if (/^vpn ipsec (?:ike|esp)-group \S+ lifetime$/.test(key)) duration(value, 3600);
    if (/^vpn ipsec authentication psk \S+ secret$/.test(key)) ensure(isIpsecName(value), "교육용 PSK는 영문·숫자·-·_로 1~32자입니다");
  }
  const interfaces: Record<string, RouterInterfaceConfig> = {};
  for (const [index, port] of PORT_NAMES.router.entries()) {
    const root = `interfaces ethernet eth${index}`;
    const addresses = Object.keys(settings).filter(key => key.startsWith(`${root} address `));
    ensure(addresses.length <= 1, "물리 포트당 IPv4 주소 하나만 지원합니다");
    const address = addresses[0] === undefined ? undefined : subnet(addresses[0].slice(`${root} address `.length));
    interfaces[port] = { adminUp: settings[`${root} disable`] === undefined, ...(address === undefined ? {} : { ip: address.network, mask: address.mask }) };
  }
  const tunnels: Record<string, GreTunnelConfig> = {};
  for (const name of names(settings, "interfaces tunnel")) {
    const root = `interfaces tunnel ${name}`;
    const addresses = Object.keys(settings).filter(key => key.startsWith(`${root} address `));
    const sourceIp = settings[`${root} source-address`], destination = settings[`${root} remote`];
    const source = PORT_NAMES.router.find(port => interfaces[port]?.ip === sourceIp);
    ensure(settings[`${root} encapsulation`] === "gre" && sourceIp !== undefined && source !== undefined && addresses.length === 1 && destination !== undefined && checkHostIpv4(destination) === null, `${name}: GRE 형식·로컬 source IP·remote·주소 하나가 필요합니다`);
    const address = subnet(addresses[0]!.slice(`${root} address `.length));
    tunnels[tunnelPort(name)] = { mode: "gre", adminUp: settings[`${root} disable`] === undefined, source: source!, destination: destination!, ip: address.network, mask: address.mask };
  }
  // `nat source rule N`: masquerade는 인터페이스 outside, IPv4 변환은 정적 NAT의 SNAT 반쪽이다 (T16.2)
  const natStatics: NatStaticEntry[] = [];
  const natSources: NatSourceRule[] = [];
  const addStatic = (insideIp: string, outsideIp: string): void => {
    if (!natStatics.some(entry => entry.insideIp === insideIp && entry.outsideIp === outsideIp)) {
      natStatics.push({ insideIp, outsideIp });
    }
  };
  // `source address`를 network·wildcard로 — `a.b.c.d/p` 또는 호스트 하나 (T16.3)
  const matchOf = (value: string): { network: string; wildcard: string } => {
    if (value.includes("/")) {
      const address = subnet(value);
      return { network: address.network, wildcard: formatIpv4(4294967295 - parseIpv4(address.mask)!) };
    }
    ensure(checkHostIpv4(value) === null, `source address가 잘못되었습니다: ${value}`);
    return { network: value, wildcard: "0.0.0.0" };
  };
  for (const rule of names(settings, "nat source rule")) {
    const root = `nat source rule ${rule}`;
    const outbound = settings[`${root} outbound-interface`];
    const translation = settings[`${root} translation address`];
    ensure(outbound !== undefined && translation !== undefined, `${root}: outbound-interface와 translation address가 함께 필요합니다`);
    const port = /^eth([0-3])$/.test(outbound!) ? PORT_NAMES.router[Number(outbound![3])] : undefined;
    ensure(port !== undefined, `${root}: outbound-interface는 eth0~eth3입니다`);
    interfaces[port!] = { ...interfaces[port!]!, nat: "outside" };
    const source = settings[`${root} source address`];
    if (translation === "masquerade") {
      // source address가 있으면 그 범위만 고르는 overload 규칙이다 (T16.3)
      if (source !== undefined) {
        const match = matchOf(source);
        natSources.push({ network: match.network, wildcard: match.wildcard, interface: port!, overload: true });
      }
      continue;
    }
    // `a-b` 범위 변환은 풀 기반 동적 NAT다. `translation port`가 있으면 overload (T16.3)
    const range = /^(\d{1,3}(?:\.\d{1,3}){3})-(\d{1,3}(?:\.\d{1,3}){3})$/.exec(translation!);
    if (range !== null) {
      ensure(source !== undefined, `${root}: 범위 변환은 source address가 필요합니다`);
      const match = matchOf(source!);
      natSources.push({ network: match.network, wildcard: match.wildcard,
        poolStart: range[1]!, poolEnd: range[2], overload: settings[`${root} translation port`] !== undefined });
      continue;
    }
    ensure(source !== undefined && checkHostIpv4(source) === null && checkHostIpv4(translation!) === null,
      `${root}: 주소 변환은 source address와 IPv4 translation address가 함께 필요합니다`);
    addStatic(source!, translation!);
  }
  // `nat destination rule N`: outside로 들어온 패킷의 고정 DNAT — 정적 NAT의 반대쪽 반 (T16.2)
  for (const rule of names(settings, "nat destination rule")) {
    const root = `nat destination rule ${rule}`;
    const inbound = settings[`${root} inbound-interface`];
    const destination = settings[`${root} destination address`];
    const translation = settings[`${root} translation address`];
    ensure(inbound !== undefined && destination !== undefined && translation !== undefined
      && checkHostIpv4(destination) === null && checkHostIpv4(translation) === null,
      `${root}: inbound-interface·destination address·IPv4 translation address가 함께 필요합니다`);
    const port = /^eth([0-3])$/.test(inbound!) ? PORT_NAMES.router[Number(inbound![3])] : undefined;
    ensure(port !== undefined, `${root}: inbound-interface는 eth0~eth3입니다`);
    interfaces[port!] = { ...interfaces[port!]!, nat: "outside" };
    addStatic(translation!, destination!);
  }
  const staticRoutes: StaticRoute[] = [];
  for (const key of Object.keys(settings)) if (key.startsWith("protocols static route ")) {
    const match = /^protocols static route (\S+) next-hop (\S+)$/.exec(key)!;
    const address = subnet(match[1]!);
    ensure(networkAddress(address.network, address.mask) === address.network && checkHostIpv4(match[2]!) === null, "정적 경로의 prefix/next-hop이 잘못되었습니다");
    staticRoutes.push({ network: address.network, mask: address.mask, nextHop: match[2]! });
  }
  const ipsec: Record<string, IpsecProfileConfig> = {};
  for (const name of names(settings, "vpn ipsec site-to-site peer")) {
    const root = `vpn ipsec site-to-site peer ${name}`;
    const required = (key: string): string => { const value = settings[`${root} ${key}`]; ensure(value !== undefined, `${name}: ${key}가 필요합니다`); return value!; };
    const local = required("local-address"), peer = required("remote-address");
    const port = PORT_NAMES.router.find(port => interfaces[port]?.ip === local);
    ensure(port !== undefined && checkHostIpv4(peer) === null, `${name}: local-address는 자기 물리 IP여야 합니다`);
    ensure(settings[`vpn ipsec interface eth${PORT_NAMES.router.indexOf(port!)}`] !== undefined, `${name}: vpn ipsec interface 설정이 필요합니다`);
    ensure(required("authentication mode") === "pre-shared-secret", "PSK 방식만 지원합니다");
    const keys = names(settings, "vpn ipsec authentication psk").filter(psk => {
      const prefix = `vpn ipsec authentication psk ${psk}`;
      return settings[`${prefix} id ${settings[`${root} authentication local-id`] ?? local}`] !== undefined && settings[`${prefix} id ${settings[`${root} authentication remote-id`] ?? peer}`] !== undefined;
    });
    ensure(keys.length === 1, `${name}: 양쪽 id와 일치하는 PSK 하나가 필요합니다`);
    const secret = settings[`vpn ipsec authentication psk ${keys[0]} secret`];
    ensure(secret !== undefined && isIpsecName(secret), "교육용 PSK는 영문·숫자·-·_로 1~32자입니다");
    const ike = `vpn ipsec ike-group ${required("ike-group")}`, esp = `vpn ipsec esp-group ${required("default-esp-group")}`;
    const get = (path: string): string => { const value = settings[path]; ensure(value !== undefined, `${path}가 필요합니다`); return value!; };
    const policy = { ike: get(`${ike} key-exchange`), ikeEncryption: get(`${ike} proposal 10 encryption`), ikeHash: get(`${ike} proposal 10 hash`), dh: get(`${ike} proposal 10 dh-group`), espEncryption: get(`${esp} proposal 10 encryption`), espHash: get(`${esp} proposal 10 hash`), pfs: settings[`${esp} pfs`] ?? "enable" };
    ensure(["ikev1", "ikev2"].includes(policy.ike) && ["aes128", "aes256"].includes(policy.ikeEncryption) && ["aes128", "aes256"].includes(policy.espEncryption) && ["sha1", "sha256"].includes(policy.ikeHash) && ["sha1", "sha256"].includes(policy.espHash) && ["14", "19"].includes(policy.dh) && ["enable", "disable"].includes(policy.pfs) && get(`${esp} mode`) === "tunnel", "미지원 IKE/ESP 정책 값입니다");
    duration(settings[`${ike} lifetime`], 28800);
    const old = base.ipsec?.[name];
    ipsec[name] = { bypassWhenDisabled: true, adminUp: settings[`${root} tunnel 0 disable`] === undefined, interface: port!, peer, keyId: secret!,
      localId: settings[`${root} authentication local-id`] ?? local, remoteId: settings[`${root} authentication remote-id`] ?? peer,
      local: subnet(required("tunnel 0 local prefix")), remote: subnet(required("tunnel 0 remote prefix")),
      inboundSpi: old?.peer === peer && old.interface === port ? old.inboundSpi ?? spi(peer, local) : spi(peer, local),
      outboundSpi: old?.peer === peer && old.interface === port ? old.outboundSpi ?? spi(local, peer) : spi(local, peer),
      lifetimeSeconds: duration(settings[`${esp} lifetime`], 3600), policy: JSON.stringify(policy) };
  }
  // SSH (T0.56): `service ssh` 노드가 켜짐, `service ssh disable` 플래그가 끔.
  // 계정은 `system login user <u> authentication plaintext-password <pw>` — 비밀번호 없는 사용자는 없다
  const sshUsers = names(settings, "system login user").map(user => ({
    user, password: settings[`system login user ${user} authentication plaintext-password`]!,
  }));
  const ssh = settings["service ssh"] === undefined && sshUsers.length === 0 ? undefined : {
    enabled: settings["service ssh"] !== undefined && settings["service ssh disable"] === undefined,
    users: sshUsers,
  };
  return { ...base, cliStyle: "vyos", vpnMode: undefined, interfaces, staticRoutes,
    ssh,
    natStatics: natStatics.length === 0 ? undefined : natStatics,
    natSources: natSources.length === 0 ? undefined : natSources,
    tunnels: Object.keys(tunnels).length ? tunnels : undefined, ipsec: Object.keys(ipsec).length ? ipsec : undefined,
    vyos: Object.fromEntries(Object.entries(settings).sort(([a], [b]) => a.localeCompare(b))) };
}
