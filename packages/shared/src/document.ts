// 저장되는 문서(Document)의 형태. 출처: docs/project-plan/03-system-design.md 3.4절 "Document 형태", AD-9.
// 모든 값은 변경 불가능한 단순 JSON 자료다 (AD-16). 바꿀 때는 새 객체를 만든다.

export const DEVICE_KINDS = ["pc", "server", "switch", "router", "hub", "l3switch", "lb", "cloud"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** 장비 종류별 포트의 전체 이름. 배열의 순서가 포트 순번이다 (MAC 주소 계산에 씀) */
export const PORT_NAMES = {
  pc: ["Ethernet0"],
  server: ["Ethernet0"],
  switch: [
    "FastEthernet0/1",
    "FastEthernet0/2",
    "FastEthernet0/3",
    "FastEthernet0/4",
    "FastEthernet0/5",
    "FastEthernet0/6",
    "FastEthernet0/7",
    "FastEthernet0/8",
  ],
  router: [
    "GigabitEthernet0/0",
    "GigabitEthernet0/1",
    "GigabitEthernet0/2",
    "GigabitEthernet0/3",
  ],
  hub: ["Port0", "Port1", "Port2", "Port3", "Port4", "Port5", "Port6", "Port7"],
  l3switch: [
    "FastEthernet0/1",
    "FastEthernet0/2",
    "FastEthernet0/3",
    "FastEthernet0/4",
    "FastEthernet0/5",
    "FastEthernet0/6",
    "FastEthernet0/7",
    "FastEthernet0/8",
  ],
  // LB (T0.34). 리눅스 기반이라 포트 이름이 ethN이다
  lb: ["eth0", "eth1"],
  // 인터넷 클라우드 (T0.68). 포트별로 1.0.0.0/8을 자른 /30 링크망이 고정 배정된다
  cloud: ["Port0", "Port1", "Port2", "Port3", "Port4", "Port5"],
} as const satisfies Record<DeviceKind, readonly string[]>;

/** 그 종류의 장비에 있는 포트 이름인지 */
export function isPortName(kind: DeviceKind, port: string): boolean {
  return (PORT_NAMES[kind] as readonly string[]).includes(port);
}

/** 포트 순번 (0부터). 없는 포트면 -1 */
export function portIndex(kind: DeviceKind, port: string): number {
  return (PORT_NAMES[kind] as readonly string[]).indexOf(port);
}

export interface Position {
  readonly x: number;
  readonly y: number;
}

/** 포트 참조. `port`는 항상 전체 이름이다 (AD-9) */
export interface PortRef {
  readonly deviceId: string;
  readonly port: string;
}

/** PC의 OS (T0.7). 콘솔 명령어와 출력 형식, 아이콘이 달라진다. 네트워크 동작은 같다 */
export const OS_KINDS = ["windows", "linux"] as const;
export type OsKind = (typeof OS_KINDS)[number];

/** `os`가 없는 PC의 OS. 옛 문서와 예시 토폴로지가 그대로 읽힌다 */
export const DEFAULT_OS: OsKind = "windows";

/**
 * 속성 패널에서 고르는 PC의 종류 (T0.20). `server`는 서비스를 돌리는 Linux다.
 * 콘솔과 네트워크 동작을 가르는 값은 `OsKind`(`osOf`)이고, 서버는 거기서 Linux다
 */
export const PC_OS_CHOICES = ["windows", "linux", "server"] as const;
export type PcOsChoice = (typeof PC_OS_CHOICES)[number];

/** 서버가 돌리는 서비스 (T0.20) */
export const SERVICE_KINDS = ["http", "https", "dns", "ntp", "ftp", "ssh"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

/** 서비스가 듣는 프로토콜과 포트. FTP는 제어 연결(21)만 쓴다 */
export const SERVICE_PORTS = {
  http: { protocol: "tcp", port: 80 },
  https: { protocol: "tcp", port: 443 },
  dns: { protocol: "udp", port: 53 },
  ntp: { protocol: "udp", port: 123 },
  ftp: { protocol: "tcp", port: 21 },
  ssh: { protocol: "tcp", port: 22 },
} as const satisfies Record<ServiceKind, { readonly protocol: "tcp" | "udp"; readonly port: number }>;

/** DNS 서비스가 답하는 이름 하나 (A 레코드) */
export interface DnsRecord {
  readonly name: string;
  readonly address: string;
}

/** 서버가 HTTP·FTP로 내놓는 파일 (T0.58). 이름에 `/`는 쓰지 않는다 */
export interface ServerFile {
  readonly name: string;
  readonly content: string;
}

/** SSH 로그인 계정 하나 (T0.56). 서버는 인스펙터에서, 라우터는 CLI로 만든다 */
export interface SshAccount {
  readonly user: string;
  readonly password: string;
}

/**
 * PC 구성. IP가 없으면 세 값 모두 없다. `mask`는 `ip`와 함께만, `gateway`는 `ip`가 있을 때만 있다.
 * `os`는 IP와 상관없이 따로 있고, 없으면 `DEFAULT_OS`다. 서버 기능은 `ServerConfig`에만 있다 (T0.25)
 */
export interface PcConfig {
  readonly ip?: string;
  readonly mask?: string;
  readonly gateway?: string;
  readonly os?: OsKind;
  /** 포트 켜짐 (T0.14). 칸이 없으면 켜짐. 옛 문서는 그대로 읽힌다 */
  readonly adminUp?: boolean;
}

/** 장비의 OS. 칸이 없으면 `DEFAULT_OS`. 서버는 Linux다 (T0.20) */
export function osOf(config: PcConfig | ServerConfig): OsKind {
  return config.os === "server" ? "linux" : (config.os ?? DEFAULT_OS);
}

export interface Vlan {
  readonly id: number;
  readonly name: string;
}

/** 허용 VLAN의 범위 [시작, 끝]. 끝을 포함한다 */
export type VlanRange = readonly [start: number, end: number];

export const SWITCHPORT_MODES = ["access", "trunk"] as const;
export type SwitchportMode = (typeof SWITCHPORT_MODES)[number];

export interface SwitchPortConfig {
  readonly adminUp: boolean;
  readonly mode: SwitchportMode;
  /** access 포트의 VLAN. 없으면 VLAN 1 */
  readonly accessVlan?: number;
  /** trunk 포트가 허용하는 VLAN. 없으면 전부 허용 */
  readonly allowedVlans?: readonly VlanRange[];
}

/** Switch 구성. `ports`에 없는 포트는 기본값(켜짐, access, VLAN 1)이다 */
export interface SwitchConfig {
  readonly vlans: readonly Vlan[];
  readonly ports: Readonly<Record<string, SwitchPortConfig>>;
}

/**
 * L3 Switch 포트 구성 (T0.33). `routed`는 `no switchport`로 만든 L3 포트다 —
 * VLAN·MAC 학습에서 빠지고 `interfaces[이름]`의 IP로 라우팅한다
 */
export interface L3SwitchPortConfig extends SwitchPortConfig {
  readonly routed?: boolean;
}

/** SVI 이름 (`interface vlan 10` → `Vlan10`). L3 인터페이스 키다 */
export const SVI_PREFIX = "Vlan";
export const isSviName = (name: string): boolean => /^Vlan\d+$/.test(name);
export function sviVlan(name: string): number | null {
  const match = /^Vlan(\d+)$/.exec(name);
  return match === null ? null : Number(match[1]);
}

/**
 * L3 Switch 구성 (T0.33). L2 부분(vlans·ports)은 Switch와 같고, L3 부분은
 * `interfaces`의 키가 SVI(`Vlan10`) 또는 라우티드 포트 이름이다.
 * `ipRouting`이 없으면 L3는 꺼져 있다 — SVI가 있어도 전달은 하지 않고 로컬 응답만 한다
 */
export interface L3SwitchConfig {
  readonly vlans: readonly Vlan[];
  readonly ports: Readonly<Record<string, L3SwitchPortConfig>>;
  /** `ip routing`. 없으면 라우팅이 꺼져 있다 */
  readonly ipRouting?: boolean;
  /** L3 인터페이스. 키는 `Vlan<id>`(SVI) 또는 `routed: true`인 포트 이름 */
  readonly interfaces: Readonly<Record<string, RouterInterfaceConfig>>;
  readonly staticRoutes: readonly StaticRoute[];
  /** 없으면 RIP를 쓰지 않음. `router rip`로 생기고 `no router rip`로 사라진다 */
  readonly rip?: RipConfig;
}

export interface RouterInterfaceConfig {
  readonly adminUp: boolean;
  /** `ip`와 `mask`는 함께 있거나 함께 없다 */
  readonly ip?: string;
  readonly mask?: string;
  /** NAT 역할 (T16.2). `outside`로 나가는 패킷은 출발지를 이 인터페이스의 IP로 바꾼다 */
  readonly nat?: "inside" | "outside";
}

export interface StaticRoute {
  readonly network: string;
  readonly mask: string;
  readonly nextHop: string;
  /** AD (T11.1.1). 1~255. 없으면 1. 1은 저장하지 않는다 */
  readonly distance?: number;
}

/** 논리 GRE 인터페이스. 물리 케이블/ARP 포트와 분리한다. 미완성 설정도 저장할 수 있다. */
export interface GreTunnelConfig extends RouterInterfaceConfig {
  readonly mode: "gre";
  /** 바깥 IP를 가진 물리 인터페이스의 전체 이름 */
  readonly source?: string;
  readonly destination?: string;
}

export interface Ipv4Subnet {
  readonly network: string;
  readonly mask: string;
}

/** 실제 암호화/IKE가 없는 교육용 ESP tunnel 정책. keyId는 공개 실습 식별자다. */
export interface IpsecProfileConfig {
  /** 교육용 정책 일치 검사. 실제 알고리즘 실행/IKE 협상을 뜻하지 않는다. */
  readonly policy?: string;
  readonly localId?: string;
  readonly remoteId?: string;
  readonly adminUp: boolean;
  /** VyOS disable은 보호 정책을 비활성화한다. 기존 IOS 교육 모델은 fail-closed를 유지한다. */
  readonly bypassWhenDisabled?: boolean;
  readonly interface?: string;
  readonly peer?: string;
  readonly local?: Ipv4Subnet;
  readonly remote?: Ipv4Subnet;
  readonly keyId?: string;
  readonly inboundSpi?: number;
  readonly outboundSpi?: number;
  /** 기본 3600초. 가상 시계로 판단하며 자동 rekey는 하지 않는다. */
  readonly lifetimeSeconds?: number;
}

/** RIP 구성 (T11.2.1). version 2, no auto-summary로 고정이라 저장하지 않는다 */
export interface RipConfig {
  /** `network`로 넣은 주소. 클래스풀 네트워크(A: /8, B: /16, C: /24)로 맞춰 저장. 작은 주소부터 */
  readonly networks: readonly string[];
  /** 보내지 않고 듣기만 하는 인터페이스. 포트 순서대로 */
  readonly passiveInterfaces: readonly string[];
}

/** 정적 NAT 1:1 주소 대응 (T16.2). `ip nat inside source static <inside> <outside>`. 안쪽 호스트가 바깥 주소로 고정 대응된다 */
export interface NatStaticEntry {
  readonly insideIp: string;
  readonly outsideIp: string;
}

/** NAT 주소 풀 (T16.3). `ip nat pool <name> <start> <end> netmask <mask>`. 동적 NAT와 overload가 쓸 바깥 주소 범위 */
export interface NatPool {
  readonly name: string;
  readonly startIp: string;
  readonly endIp: string;
  readonly netmask: string;
}

/** 표준 번호 ACL 한 줄 (T16.3). `access-list <1-99> permit|deny <net> <wildcard>`. 같은 listId의 줄이 위에서부터 평가된다 */
export interface AccessListEntry {
  readonly listId: number;
  readonly action: "permit" | "deny";
  readonly network: string;
  readonly wildcard: string;
}

/** 동적 NAT 규칙 (T16.3). `ip nat inside source list <acl> pool <name> [overload]` 또는 `... interface <iface> overload` */
export interface NatSourceRule {
  /** 출발지를 가를 표준 ACL 번호 (ios). 없으면 network·wildcard가 직접 매칭한다 (vyos·linux) */
  readonly listId?: number;
  /** 직접 매칭하는 출발지 네트워크 (vyos `source address`, linux `-s`). listId가 있으면 안 쓴다 */
  readonly network?: string;
  readonly wildcard?: string;
  /** 변환에 쓸 풀 이름 (ios). poolStart·interface와 셋 중 하나만 있다 */
  readonly pool?: string;
  /** 인라인 풀 범위 (vyos `translation address a-b`, linux `--to-source a-b`) */
  readonly poolStart?: string;
  readonly poolEnd?: string;
  /** overload용 outside 인터페이스 이름 */
  readonly interface?: string;
  /** 참이면 주소 하나를 포트로 나눠 쓰는 PAT. 거짓이면 풀 주소의 1:1 동적 대응 */
  readonly overload: boolean;
}

/** Router 구성. `interfaces`에 없는 인터페이스는 설정된 적이 없는 것이다 */
export const VPN_MODES = ["off", "gre", "ipsec"] as const;
export type VpnMode = (typeof VPN_MODES)[number];

export interface RouterConfig {
  readonly cliStyle?: "ios" | "vyos" | "linux";
  /** 적용된 VyOS 지원 설정. candidate는 저장하지 않는다. */
  readonly vyos?: Readonly<Record<string, string>>;
  /** 생략하면 기존 터널/정책 설정을 따른다. off는 명시적으로 일반 라우팅을 선택한다. */
  readonly vpnMode?: VpnMode;
  /** 리눅스 라우터의 `net.ipv4.ip_forward` (T16.1). 생략하면 켜져 있다 */
  readonly ipForward?: boolean;
  readonly interfaces: Readonly<Record<string, RouterInterfaceConfig>>;
  readonly staticRoutes: readonly StaticRoute[];
  /** 없으면 RIP를 쓰지 않음. `router rip`로 생기고 `no router rip`로 사라진다 (T11.2.1) */
  readonly rip?: RipConfig;
  /** 정적 NAT 대응 (T16.2). 없거나 빈 목록이면 동적 변환만 */
  readonly natStatics?: readonly NatStaticEntry[];
  /** NAT 주소 풀 (T16.3). `ip nat pool`로 만든다 */
  readonly natPools?: readonly NatPool[];
  /** 표준 번호 ACL (T16.3). `access-list`로 만든다. 지금은 NAT 규칙의 출발지 선택에 쓴다 */
  readonly accessLists?: readonly AccessListEntry[];
  /** 동적 NAT 규칙 (T16.3). 비어 있고 outside 인터페이스만 있으면 묵시적 masquerade다 */
  readonly natSources?: readonly NatSourceRule[];
  readonly tunnels?: Readonly<Record<string, GreTunnelConfig>>;
  /** 논리 루프백 인터페이스 (T0.57). IOS `interface LoopbackN`으로 만든다. 링크가 없고 만들면 켜진다 */
  readonly loopbacks?: Readonly<Record<string, RouterInterfaceConfig>>;
  readonly ipsec?: Readonly<Record<string, IpsecProfileConfig>>;
  /** SSH 수신 설정 (T0.56). 칸이 없으면 SSH를 받지 않는다 */
  readonly ssh?: RouterSshConfig;
}

/** Router의 SSH 수신 설정 (T0.56). IOS는 domain-name+RSA 키+계정이 모두 있어야 켜진다 */
export interface RouterSshConfig {
  /** VyOS·Linux 라우터의 sshd 켜짐 (VyOS `set service ssh`, Linux `systemctl start ssh`) */
  readonly enabled?: boolean;
  /** IOS `ip domain-name` — RSA 키와 함께 SSH의 전제 조건 */
  readonly domainName?: string;
  /** IOS `crypto key generate rsa`의 modulus 비트 */
  readonly keyBits?: number;
  /** 로그인 계정. IOS `username <u> secret <p>`, VyOS `set system login user` */
  readonly users: readonly SshAccount[];
}

/**
 * 라우터가 TCP/22에서 SSH를 받는지. cliStyle별로 켜지는 조건이 다르다:
 * IOS는 domain-name·RSA 키·계정 셋이 모두 있을 때, VyOS·Linux는 `enabled`가 참일 때다
 */
export function routerSshOpen(config: RouterConfig): boolean {
  const ssh = config.ssh;
  if (ssh === undefined) return false;
  if ((config.cliStyle ?? "ios") === "ios") {
    return ssh.domainName !== undefined && ssh.keyBits !== undefined && ssh.users.length > 0;
  }
  return ssh.enabled === true;
}

// 패킷 필터 (T14.2.1). 처음에는 Firewall 장비의 것이었고, T0.21에서 서버로 쓰는 PC로 옮겼다.
// 이름의 Firewall은 "방화벽 규칙"이라는 뜻으로 남겼다. 장비 종류가 아니다.

/** iptables의 filter 테이블에 있는 체인. 순서는 `iptables -L`이 보이는 순서다 */
export const FIREWALL_CHAINS = ["INPUT", "FORWARD", "OUTPUT"] as const;
export type FirewallChain = (typeof FIREWALL_CHAINS)[number];

/** 체인의 기본 정책. REJECT는 정책이 될 수 없다 (실제 iptables와 같음) */
export const FIREWALL_POLICIES = ["ACCEPT", "DROP"] as const;
export type FirewallPolicy = (typeof FIREWALL_POLICIES)[number];

export const FIREWALL_TARGETS = ["ACCEPT", "DROP", "REJECT"] as const;
export type FirewallTarget = (typeof FIREWALL_TARGETS)[number];

export const FIREWALL_PROTOCOLS = ["icmp", "tcp", "udp"] as const;
export type FirewallProtocol = (typeof FIREWALL_PROTOCOLS)[number];

export const FIREWALL_ICMP_TYPES = ["echo-request", "echo-reply", "destination-unreachable", "time-exceeded"] as const;
export type FirewallIcmpType = (typeof FIREWALL_ICMP_TYPES)[number];

/**
 * 필터 규칙 하나. 없는 칸은 "모두"다. 있는 칸이 모두 맞아야 규칙이 맞는다.
 * 무상태다: 연결 상태(`-m state`)는 보지 않는다 (02 문서 F1)
 */
export interface FirewallRule {
  /** `-p`. 없으면 모든 프로토콜 */
  readonly protocol?: FirewallProtocol;
  /** `-s`. `네트워크/길이`로 맞춰 저장한다 (예: `10.0.0.0/24`, 주소 하나는 `/32`) */
  readonly source?: string;
  /** `-d` */
  readonly destination?: string;
  /** `-i`. 포트의 전체 이름(`Ethernet0`). INPUT과 FORWARD에만 */
  readonly inInterface?: string;
  /** `-o`. 포트의 전체 이름(`Ethernet0`). FORWARD와 OUTPUT에만 */
  readonly outInterface?: string;
  /** `--icmp-type`. `protocol`이 icmp일 때만 */
  readonly icmpType?: FirewallIcmpType;
  /** `--sport`, `--dport`. 포트 하나(`80`)나 범위(`1000:2000`). `protocol`이 tcp나 udp일 때만 */
  readonly sourcePort?: string;
  readonly destinationPort?: string;
  readonly target: FirewallTarget;
}

export interface FirewallChainConfig {
  readonly policy: FirewallPolicy;
  readonly rules: readonly FirewallRule[];
}

/** 서버의 필터: 체인마다 기본 정책과 규칙 목록 (T0.21) */
export type PcFilter = Readonly<Record<FirewallChain, FirewallChainConfig>>;

interface DeviceBase {
  /** web이 `crypto.randomUUID()`로 만든 UUID */
  readonly id: string;
  /** 영문자, 숫자, `-`, `_`. 1~32자. 토폴로지 안에서 겹치지 않는다 */
  readonly name: string;
  readonly position: Position;
}

/**
 * Server 구성 (T0.25). PC 구성에서 복사한 독립 타입 — 서버를 따로 바꿀 수 있다.
 * `os`는 항상 `server`다. 필드가 `PcConfig`와 같아 `osOf`·`servicesOf` 같은 구성 헬퍼가 그대로 쓰인다
 */
export interface ServerConfig {
  readonly ip?: string;
  readonly mask?: string;
  readonly gateway?: string;
  readonly os?: "server";
  /** 포트 켜짐 (T0.14). 칸이 없으면 켜짐 */
  readonly adminUp?: boolean;
  /** 켜 둔 서비스 (T0.20). 칸이 없으면 다섯 개 다 켜짐. `SERVICE_KINDS`의 순서 */
  readonly services?: readonly ServiceKind[];
  /** SSH 접속 계정 (T0.56). 칸이 없으면 처음 계정(admin/ping9) */
  readonly sshAccounts?: readonly SshAccount[];
  /** DNS 서비스가 답하는 이름 (T0.20). 칸이 없으면 없음 */
  readonly dnsRecords?: readonly DnsRecord[];
  /** HTTP·HTTPS·FTP가 내놓는 파일 (T0.58). 칸이 없으면 정해진 기본 파일 둘 */
  readonly files?: readonly ServerFile[];
  /** NTP 서비스가 답하는 계층 (T0.58). 칸이 없으면 1 */
  readonly ntpStratum?: number;
  /** iptables의 필터 규칙 (T0.21). 칸이 없으면 세 체인 모두 ACCEPT에 규칙 없음 */
  readonly filter?: PcFilter;
}

export interface PcDevice extends DeviceBase {
  readonly kind: "pc";
  readonly config: PcConfig;
}

/** 서버. PC를 복사해 만든 독립 장비다 (T0.25). `config.os`는 항상 `server`다 */
export interface ServerDevice extends DeviceBase {
  readonly kind: "server";
  readonly config: ServerConfig;
}

export interface SwitchDevice extends DeviceBase {
  readonly kind: "switch";
  readonly config: SwitchConfig;
}

export interface RouterDevice extends DeviceBase {
  readonly kind: "router";
  readonly config: RouterConfig;
}

/** Hub 구성 (T0.32). 관리가 없는 장비라 칸이 없다 — VLAN도 MAC 테이블도 없다 */
export type HubConfig = Record<string, never>;

export interface HubDevice extends DeviceBase {
  readonly kind: "hub";
  readonly config: HubConfig;
}

export interface L3SwitchDevice extends DeviceBase {
  readonly kind: "l3switch";
  readonly config: L3SwitchConfig;
}

/**
 * LB(로드밸런서) 구성 (T0.34). HAProxy의 `listen` 블록이 `frontends`다 —
 * 받는 TCP 포트와 보낼 백엔드 목록·가중치. DNAT 방식이라 백엔드의 응답도 LB를 거친다.
 * L3 부분은 라우터와 같다: `interfaces`는 eth0/eth1별 IP, `staticRoutes`는 정적 경로.
 */
export interface LbBackend {
  readonly ip: string;
  readonly port: number;
  /** 가중 라운드로빈의 비율. 1 이상 */
  readonly weight: number;
  /** http 모드: 요청 경로가 이 접두로 시작할 때만 이 백엔드가 후보다 (HAProxy의 path_beg, T0.35) */
  readonly pathPrefix?: string;
}

export interface LbFrontend {
  readonly listenPort: number;
  /** `tcp`는 L4 전달, `http`는 L7 프록시 (T0.35) */
  readonly mode: "tcp" | "http";
  readonly backends: readonly LbBackend[];
}

export interface LbConfig {
  readonly interfaces: Readonly<Record<string, RouterInterfaceConfig>>;
  readonly staticRoutes: readonly StaticRoute[];
  readonly frontends: readonly LbFrontend[];
}

export interface LbDevice extends DeviceBase {
  readonly kind: "lb";
  readonly config: LbConfig;
}

/**
 * 인터넷 클라우드 구성 (T0.68). 가상의 ISP 망 — 설정하는 게 없다.
 * 포트 순번 i에는 `1.0.0.{4i}/30` 링크망이 배정되어 클라우드는 `.{4i+1}`, 붙은 장비는 `.{4i+2}`를 쓴다
 */
export type CloudConfig = Record<string, never>;

export interface CloudDevice extends DeviceBase {
  readonly kind: "cloud";
  readonly config: CloudConfig;
}

/** 클라우드 포트 순번(0~3)의 링크망. 마스크는 /30 (255.255.255.252) */
export function cloudPortInfo(index: number): {
  readonly network: string; readonly mask: string; readonly cloudIp: string; readonly peerIp: string;
} {
  const base = 4 * index;
  return {
    network: `1.0.0.${base}`,
    mask: "255.255.255.252",
    cloudIp: `1.0.0.${base + 1}`,
    peerIp: `1.0.0.${base + 2}`,
  };
}

export type Device = PcDevice | ServerDevice | SwitchDevice | RouterDevice | HubDevice | L3SwitchDevice | LbDevice | CloudDevice;

/** PC 장비인지. 객체를 `PcDevice`로 좁힌다 */
export function isPcDevice(device: Device | undefined): device is PcDevice {
  return device !== undefined && device.kind === "pc";
}

/** Server 장비인지. 객체를 `ServerDevice`로 좁힌다 */
export function isServerDevice(device: Device | undefined): device is ServerDevice {
  return device !== undefined && device.kind === "server";
}

/** Hub 장비인지. 객체를 `HubDevice`로 좁힌다 */
export function isHubDevice(device: Device | undefined): device is HubDevice {
  return device !== undefined && device.kind === "hub";
}

/** L3 Switch 장비인지. 객체를 `L3SwitchDevice`로 좁힌다 */
export function isL3SwitchDevice(device: Device | undefined): device is L3SwitchDevice {
  return device !== undefined && device.kind === "l3switch";
}

/** LB 장비인지. 객체를 `LbDevice`로 좁힌다 */
export function isLbDevice(device: Device | undefined): device is LbDevice {
  return device !== undefined && device.kind === "lb";
}

/** 클라우드 장비인지. 객체를 `CloudDevice`로 좁힌다 */
export function isCloudDevice(device: Device | undefined): device is CloudDevice {
  return device !== undefined && device.kind === "cloud";
}

/** 링크. 방향이 없고 서로 다른 두 장비를 잇는다 */
export interface Link {
  readonly id: string;
  readonly ends: readonly [PortRef, PortRef];
}

export interface TopologyDocument {
  readonly schemaVersion: 1;
  readonly devices: readonly Device[];
  readonly links: readonly Link[];
}

/** 장비도 링크도 없는 문서 */
export const EMPTY_DOCUMENT: TopologyDocument = {
  schemaVersion: 1,
  devices: [],
  links: [],
};
