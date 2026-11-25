import { BROADCAST_MAC, PORT_NAMES, RIP_MULTICAST_MAC, SERVICE_PORTS, UNKNOWN_MAC, checkHostIpv4, checkInterfaceAddress, formatIpv4, isIcmpError, isLoopbackName, isSameNetwork, isTunnelName, maskToPrefixLength, parseIpv4, routerInterfaces, routerSshOpen, greEnabled } from "@ping9/shared";
import type { ApplicationData, FrameSnapshot, IcmpErrorType, IcmpMessage, Ipv4Header, NatSourceRule, NatTranslationView, Reason, RouterConfig, RouterDevice, RouterView, TcpFlags, TopologyDocument } from "@ping9/shared";

import type { Frame, SimContext, TimerRef } from "../../kernel";
import { ArpModule } from "../../protocols/arp";
import type { PendingSend } from "../../protocols/arp";
import { transportLayersOf } from "../../protocols/transport";
import { deviceRef, findDevice, isAdminUp, portLink, portMac } from "../../topology";
import { portViewsOf } from "../../views";
import { transmit } from "../link";
import type { ConfigChange, DeviceModel } from "../model";
import { RipModule } from "./rip";
import { connectedRoutes, lookupRoute, routingTable, tunnelStates } from "./routing";
import type { RouteDecision, RoutingEntry } from "./routing";
import { IpsecModule } from "./ipsec";

const SSH_PORT = SERVICE_PORTS.ssh.port;

/** linux·vyos 스타일 라우터가 직접 만드는 패킷의 TTL */
export const ROUTER_TTL = 64;

/** 라우터가 직접 만드는 패킷의 TTL. ios(기본 콘솔)는 시스코처럼 255, linux·vyos는 64다 (T16.2) */
export const routerTtlOf = (cliStyle: RouterConfig["cliStyle"]): number =>
  cliStyle === "linux" || cliStyle === "vyos" ? ROUTER_TTL : 255;

/** NAT 바인딩의 유휴 한계 (T16.2). 이 시간(마이크로초, 300초) 동안 패킷이 없으면 지운다 */
export const NAT_IDLE_US = 300_000_000;

/** NAT 변환 한 건 (T16.2). inside 호스트의 논리 포트가 바깥 주소의 natPort로 바뀐다 */
interface NatBinding {
  readonly protocol: "tcp" | "udp" | "icmp";
  readonly insideIp: string;
  /** inside 호스트의 논리 포트. ICMP는 echo의 sequence다 */
  readonly insidePort: number;
  readonly peerIp: string;
  /** 상대방(서버)의 논리 포트. ICMP는 0이다 */
  readonly peerPort: number;
  /** 바깥에서 보이는 주소. outside 인터페이스 IP이거나 풀에서 배정된 주소다 (T16.3) */
  readonly outsideIp: string;
  /** outsideIp에서 쓰는 논리 포트. ICMP는 sequence를 그대로 쓴다 */
  readonly natPort: number;
  /** 마지막으로 이 바인딩을 쓴 시각. 유휴가 NAT_IDLE_US를 넘으면 지운다 */
  lastSeen: number;
}

/** 풀에서 안쪽 호스트에 배정된 바깥 주소 (T16.3). overload이면 바인딩들이 이 주소를 포트로 나눠 쓴다 */
interface NatAddr {
  readonly insideIp: string;
  readonly ip: string;
  readonly overload: boolean;
  lastSeen: number;
}

/** ACL listId의 줄을 위에서부터 평가해 첫 매치의 permit 여부를 돌려준다. 매치가 없으면 거부다 (T16.3) */
function aclPermits(config: RouterConfig, listId: number, ip: string): boolean {
  const address = parseIpv4(ip);
  if (address === null) return false;
  for (const entry of config.accessLists ?? []) {
    if (entry.listId !== listId) continue;
    const network = parseIpv4(entry.network);
    const wildcard = parseIpv4(entry.wildcard);
    if (network === null || wildcard === null) continue;
    // 와일드카드의 1 비트는 "보지 않는" 자리다 — 나머지 자리가 모두 같으면 매치다
    if (((address ^ network) & ~wildcard) === 0) return entry.action === "permit";
  }
  return false;
}

/** NAT 규칙의 출발지 매칭 — listId가 있으면 ACL 평가, 없으면 network·wildcard 직접 매칭이다 (T16.3) */
function natRuleMatches(config: RouterConfig, rule: NatSourceRule, ip: string): boolean {
  if (rule.listId !== undefined) return aclPermits(config, rule.listId, ip);
  if (rule.network === undefined) return false;
  const address = parseIpv4(ip);
  const network = parseIpv4(rule.network);
  const wildcard = parseIpv4(rule.wildcard ?? "0.0.0.0");
  return address !== null && network !== null && wildcard !== null && ((address ^ network) & ~wildcard) === 0;
}

/** 규칙이 쓸 바깥 주소 범위 — 이름 있는 풀이거나 인라인 범위다 (T16.3) */
function natPoolRangeOf(config: RouterConfig, rule: NatSourceRule): { startIp: string; endIp: string } | undefined {
  if (rule.poolStart !== undefined) return { startIp: rule.poolStart, endIp: rule.poolEnd ?? rule.poolStart };
  if (rule.pool === undefined) return undefined;
  const pool = (config.natPools ?? []).find(candidate => candidate.name === rule.pool);
  return pool === undefined ? undefined : { startIp: pool.startIp, endIp: pool.endIp };
}

function routerIn(document: TopologyDocument, id: string): RouterDevice | undefined {
  const device = findDevice(document, id);
  return device?.kind === "router" ? device : undefined;
}

export class RouterModel implements DeviceModel {
  readonly deviceId: string;
  readonly #getDocument: () => TopologyDocument;
  readonly #arps = new Map<string, ArpModule>();
  readonly #replies = new Set<number>();
  readonly #rip: RipModule;
  readonly #ipsec: IpsecModule;
  readonly #now: () => number;
  /** NAT 바인딩. 바깥 키는 돌아오는 패킷을 그대로 찾는다: `proto:outsideIp:peerIp:peerPort:natPort` */
  readonly #natOutside = new Map<string, NatBinding>();
  /** 안쪽 키는 같은 연결이 바인딩을 다시 쓰게 한다: `proto:insideIp:insidePort:peerIp:peerPort` */
  readonly #natInside = new Map<string, NatBinding>();
  /** ICMP 오류의 인용에는 출발지 포트가 없어 쓰는 느슨한 색인: `proto:outsideIp:peerIp:peerPort` */
  readonly #natLoose = new Map<string, NatBinding>();
  /** 풀 주소 배정 (T16.3). 안쪽 호스트 → 바깥 주소. 두 색인이 같은 객체를 가리켜 lastSeen을 나눈다 */
  readonly #natAddr = new Map<string, NatAddr>();
  readonly #natAddrByIp = new Map<string, NatAddr>();
  #natNextPort = 49152;

  constructor(deviceId: string, getDocument: () => TopologyDocument, now: () => number = () => 0) {
    this.deviceId = deviceId;
    this.#getDocument = getDocument;
    const current = () => this.#device();
    this.#now = now;
    this.#ipsec = new IpsecModule(current);
    this.#rip = new RipModule({
      device: current,
      rip: () => current().config.rip,
      interfaces: () => connectedRoutes(current().config, portViewsOf(getDocument(), current()))
        .flatMap(route => {
          const ip = current().config.interfaces[route.port]?.ip;
          return ip === undefined ? [] : [{ name: route.port, ip, network: route.network, mask: route.mask }];
        }),
      macOf: (port) => portMac(current(), port),
      linkOf: (port) => portLink(getDocument(), { deviceId, port })?.linkId,
      send: (ctx, port, frame, sent) => { transmit(ctx, getDocument(), { deviceId, port }, frame, sent); },
    });
    for (const port of PORT_NAMES.router) {
      this.#arps.set(port, new ArpModule({
        get device() { return deviceRef(current()); },
        ipOf: () => current().config.interfaces[port]?.ip,
        // NAT 주소에는 라우터가 대신 ARP에 답한다 (proxy ARP). 풀은 NAT 규칙이 참조할 때만 연다 (T16.3)
        ownsIp: (_port, ip) => {
          const config = current().config;
          if ((config.natStatics ?? []).some(entry => entry.outsideIp === ip)) return true;
          const target = parseIpv4(ip);
          if (target === null) return false;
          return (config.natSources ?? []).some(rule => {
            const range = natPoolRangeOf(config, rule);
            return range !== undefined && parseIpv4(range.startIp)! <= target && target <= parseIpv4(range.endIp)!;
          });
        },
        macOf: () => portMac(current(), port),
        linkOf: () => portLink(getDocument(), { deviceId, port })?.linkId,
        transmit: (ctx, _port, frame) => { transmit(ctx, getDocument(), { deviceId, port }, frame); },
      }));
    }
  }

  #device(): RouterDevice {
    const device = routerIn(this.#getDocument(), this.deviceId);
    if (device === undefined) throw new Error(`Router ${this.deviceId} is not in the document`);
    return device;
  }

  #decision(destination: string): RouteDecision | null {
    const device = this.#device();
    const ports = portViewsOf(this.#getDocument(), device);
    return lookupRoute(routingTable(device.config, ports, this.#rip.routes()), destination);
  }

  /** 지금 쓰는 라우팅 테이블. 배운 RIP 경로를 포함한다 (T11.2.2) */
  routingTable(): readonly RoutingEntry[] {
    return routingTable(this.#device().config, portViewsOf(this.#getDocument(), this.#device()), this.#rip.routes());
  }

  /** NAT 변환 테이블 (`show ip nat translations`, T16.2·T16.3). `#natInside`가 바인딩을 한 번씩만 든 정본이다 */
  natTranslations(): readonly NatTranslationView[] {
    const device = this.#device();
    const dynamic = [...this.#natInside.values()].map(binding => ({
      protocol: binding.protocol, insideIp: binding.insideIp, insidePort: binding.insidePort,
      outsideIp: binding.outsideIp, outsidePort: binding.natPort,
      peerIp: binding.peerIp, peerPort: binding.peerPort, source: "dynamic" as const,
    }));
    // 풀의 1:1 배정은 static처럼 포트 없이 대응된다 (동적 NAT). overload 배정은 바인딩 줄이 대신 보여준다
    const assigned = [...new Set(this.#natAddr.values())]
      .filter(addr => !addr.overload)
      .map(addr => ({ protocol: "all" as const, insideIp: addr.insideIp, outsideIp: addr.ip, source: "dynamic" as const }));
    const statics = (device.config.natStatics ?? []).map(entry => ({
      protocol: "all" as const, insideIp: entry.insideIp, outsideIp: entry.outsideIp, source: "static" as const,
    }));
    return [...statics, ...assigned, ...dynamic];
  }

  /** 경로 교환 1회의 시작 (T11.2.2). RIP를 켠 Router만 보낸다 */
  startRipExchange(ctx: SimContext): void {
    this.#rip.startExchange(ctx);
  }

  onFrame(ctx: SimContext, port: string, frame: Frame): void {
    const device = this.#device();
    const ref = deviceRef(device);
    const drop = (reason: Reason<"IF_DOWN" | "NO_IP" | "NOT_FOR_ME">) => ctx.record({
      frame, deviceId: device.id, inPort: port, layer: reason.code === "NO_IP" ? "L3" : "L2", action: "drop", reason,
    });
    if (!isAdminUp(device, port)) { drop({ code: "IF_DOWN", params: { device: ref, port } }); return; }
    if (device.config.interfaces[port]?.ip === undefined) { drop({ code: "NO_IP", params: { device: ref } }); return; }
    const mac = frame.snapshot.ethernet.destinationMac;
    // RIP v2 멀티캐스트와 요청에 대한 응답 (T11.2.2)
    if (frame.snapshot.rip !== undefined && (mac === RIP_MULTICAST_MAC || mac === portMac(device, port))) {
      this.#rip.onFrame(ctx, port, frame);
      return;
    }
    if (mac !== portMac(device, port) && mac !== BROADCAST_MAC) { drop({ code: "NOT_FOR_ME", params: { device: ref } }); return; }
    const arp = this.#arps.get(port);
    if (frame.snapshot.arp !== undefined) { arp?.onArp(ctx, port, frame); return; }
    this.#receiveIp(ctx, port, frame);
  }

  #receiveIp(ctx: SimContext, port: string, frame: Frame, parentSeq?: number, protectedBy?: string): void {
    const device = this.#device(); const ref = deviceRef(device);
    const { ipv4, icmp } = frame.snapshot;
    if (ipv4 === undefined) return;
    if (ipv4.protocol === undefined && protectedBy === undefined) {
      const required = this.#ipsec.requiredInbound(ipv4);
      if (required !== undefined) { this.#rejectIpsec(ctx, frame, required, "보호 필수 트래픽이 평문으로 도착했습니다", parentSeq); return; }
    }
    if (!this.#unicast(ipv4.destinationIp)) {
      ctx.record({ frame, deviceId: device.id, inPort: port, layer: "L3", action: "drop", reason: { code: "NOT_FOR_ME", params: { device: ref } } }); return;
    }
    const received = ctx.record({ frame, deviceId: device.id, inPort: port, layer: "L3", action: "receive", ...(parentSeq === undefined ? {} : { parentSeq }),
      reason: { code: "IPV4_RECEIVED", params: { device: ref, sourceIp: ipv4.sourceIp, targetIp: ipv4.destinationIp } } });
    // outside 인터페이스로 자기 주소에 온 패킷은 NAT 바인딩을 먼저 본다 (T16.2). 맞으면 안쪽 호스트 것으로 되돌린다
    const dnat = this.#dnat(ctx, device, port, frame, ipv4, icmp, received);
    const inIpv4 = dnat?.ipv4 ?? ipv4;
    const inIcmp = dnat?.icmp ?? icmp;
    const inFrame = dnat?.frame ?? frame;
    const inReceived = dnat?.seq ?? received;
    const local = Object.entries(routerInterfaces(device.config)).some(([name, iface]) =>
      (!isTunnelName(name) || greEnabled(device.config)) && iface.adminUp && iface.ip === inIpv4.destinationIp);
    if (local) {
      if (frame.snapshot.esp !== undefined || ipv4.protocol === 50) { this.#unprotect(ctx, port, frame, received); return; }
      if (frame.snapshot.gre !== undefined || ipv4.protocol === 47) { this.#decapsulate(ctx, port, frame, received); return; }
      if (icmp?.type === "echo-request") {
        const request = ctx.record({ frame, deviceId: device.id, inPort: port, layer: "ICMP", action: "receive", parentSeq: received,
          reason: { code: "ICMP_ECHO_REQUEST_RECEIVED", params: { device: ref, sourceIp: ipv4.sourceIp, targetIp: ipv4.destinationIp } } });
        const decision = this.#decision(ipv4.sourceIp);
        if (decision !== null) this.#send(ctx, decision, {
          sourceIp: ipv4.destinationIp, destinationIp: ipv4.sourceIp, ttl: this.#ttl(),
        }, { type: "echo-reply", sequence: icmp.sequence }, "reply", request);
      } else if (isIcmpError(icmp)) {
        if (icmp.original.sourceIp !== ipv4.destinationIp || icmp.original.sequence !== icmp.sequence) return;
        ctx.record({ frame, deviceId: device.id, inPort: port, layer: "ICMP", action: "receive", parentSeq: received,
          reason: { code: "ICMP_ERROR_RECEIVED", params: { device: ref, sourceIp: ipv4.sourceIp, targetIp: ipv4.destinationIp, error: icmp.type } } });
      } else if (icmp?.type === "echo-reply") {
        ctx.record({ frame, deviceId: device.id, inPort: port, layer: "ICMP", action: "receive", parentSeq: received,
          reason: { code: "ICMP_ECHO_REPLY_RECEIVED", params: { device: ref, sourceIp: ipv4.sourceIp, targetIp: ipv4.destinationIp } } });
        this.#replies.add(icmp.sequence);
      } else if (icmp === undefined) {
        const tcp = frame.snapshot.tcp;
        // SSH 수신이 켜져 있으면 TCP/22를 종단해 배너를 답한다 (T0.56). 그 밖의 TCP·UDP는 ICMP 도달 불가로 답한다
        if (tcp !== undefined && tcp.destinationPort === SSH_PORT && routerSshOpen(device.config)) {
          this.#sshReceive(ctx, port, frame, received, ipv4, tcp);
          return;
        }
        // Router는 서비스를 돌리지 않는다 (T0.20). 자기 주소로 온 TCP·UDP는 이유를 남기고 ICMP 도달 불가로 답한다
        const transport = frame.snapshot.tcp ?? frame.snapshot.udp;
        if (transport === undefined) return;
        const closed = ctx.record({ frame, deviceId: device.id, inPort: port, parentSeq: received,
          layer: frame.snapshot.tcp === undefined ? "UDP" : "TCP", action: "drop",
          reason: { code: "PORT_CLOSED", params: {
            device: ref, protocol: frame.snapshot.tcp === undefined ? "udp" : "tcp", port: transport.destinationPort,
          } } });
        this.#error(ctx, frame, "destination-unreachable", closed);
      }
      return;
    }
    // 리눅스의 net.ipv4.ip_forward가 꺼져 있으면 자기 것이 아닌 패킷은 경로 조회 없이 버린다 (T16.1)
    if (device.config.ipForward === false) {
      ctx.record({ frame, deviceId: device.id, inPort: port, layer: "L3", action: "drop", parentSeq: received,
        reason: { code: "IP_FORWARD_DISABLED", params: { device: ref } } });
      return;
    }
    const decision = this.#decision(inIpv4.destinationIp);
    if (inIpv4.ttl <= 1 || decision === null) {
      const droppedFrame = inIpv4.ttl <= 1 ? ctx.updateFrame(inFrame, { ...inFrame.snapshot, ipv4: { ...inIpv4, ttl: 0 } }) : inFrame;
      const dropped = ctx.record({ frame: droppedFrame, deviceId: device.id, inPort: port, layer: "L3", action: "drop", parentSeq: inReceived,
        reason: inIpv4.ttl <= 1 ? { code: "TTL_EXPIRED", params: { device: ref } }
          : { code: "NO_ROUTE", params: { device: ref, targetIp: inIpv4.destinationIp } } });
      this.#error(ctx, inFrame, inIpv4.ttl <= 1 ? "time-exceeded" : "destination-unreachable", dropped);
      return;
    }
    // outside로 나가는 패킷은 출발지를 outside 인터페이스의 주소로 바꾼다 (T16.2 SNAT)
    const snat = this.#snat(ctx, device, decision.port, inIpv4, inIcmp, inFrame, inReceived);
    const outIpv4 = snat?.ipv4 ?? { ...inIpv4, ttl: inIpv4.ttl - 1 };
    this.#send(ctx, decision, outIpv4, snat?.icmp ?? inIcmp, "forward", snat?.seq ?? inReceived, snat?.frame ?? inFrame, port);
  }

  /**
   * DNAT (T16.2). outside 인터페이스로 들어와 목적지가 그 인터페이스 IP인 패킷이 바인딩과 맞으면
   * 안쪽 호스트의 주소로 되돌린다. 바인딩이 없으면 undefined — 라우터 자신이 받는 패킷이다.
   */
  #dnat(ctx: SimContext, device: RouterDevice, port: string, frame: Frame, ipv4: Ipv4Header, icmp: IcmpMessage | undefined, received: number):
    { readonly ipv4: Ipv4Header; readonly icmp: IcmpMessage | undefined; readonly frame: Frame; readonly seq: number } | undefined {
    const iface = device.config.interfaces[port];
    if (iface?.nat !== "outside") return undefined;
    this.#natSweep();
    const { tcp, udp } = frame.snapshot;
    // 정적 대응은 인터페이스 주소가 아닌 바깥 주소로도 온다 — 바인딩보다 먼저 본다
    const statik = (device.config.natStatics ?? []).find(entry => entry.outsideIp === ipv4.destinationIp);
    if (statik !== undefined) {
      const snapshot: FrameSnapshot = { ...frame.snapshot, ipv4: { ...ipv4, destinationIp: statik.insideIp } };
      const next = ctx.updateFrame(frame, snapshot);
      const seq = ctx.record({ frame: next, deviceId: device.id, inPort: port, layer: "L3", action: "forward", parentSeq: received,
        reason: { code: "NAT_TRANSLATED", params: {
          device: deviceRef(device), direction: "outside-to-inside",
          insideIp: statik.insideIp, outsideIp: statik.outsideIp, peerIp: ipv4.sourceIp,
          ...(tcp !== undefined ? { protocol: "tcp" as const, port: tcp.destinationPort }
            : udp !== undefined ? { protocol: "udp" as const, port: udp.destinationPort } : { protocol: "icmp" as const }),
        } } });
      return { ipv4: { ...ipv4, destinationIp: statik.insideIp }, icmp, frame: next, seq };
    }
    // 풀의 1:1 배정 (동적 NAT)도 바인딩 없이 대응된다 — overload 배정은 아래 포트 조회로 간다 (T16.3)
    const assigned = this.#natAddrByIp.get(ipv4.destinationIp);
    if (assigned !== undefined && !assigned.overload) {
      assigned.lastSeen = this.#now();
      const snapshot: FrameSnapshot = { ...frame.snapshot, ipv4: { ...ipv4, destinationIp: assigned.insideIp } };
      const next = ctx.updateFrame(frame, snapshot);
      const seq = ctx.record({ frame: next, deviceId: device.id, inPort: port, layer: "L3", action: "forward", parentSeq: received,
        reason: { code: "NAT_TRANSLATED", params: {
          device: deviceRef(device), direction: "outside-to-inside",
          insideIp: assigned.insideIp, outsideIp: assigned.ip, peerIp: ipv4.sourceIp,
          ...(tcp !== undefined ? { protocol: "tcp" as const, port: tcp.destinationPort }
            : udp !== undefined ? { protocol: "udp" as const, port: udp.destinationPort } : { protocol: "icmp" as const }),
        } } });
      return { ipv4: { ...ipv4, destinationIp: assigned.insideIp }, icmp, frame: next, seq };
    }
    // 목적지는 인터페이스 주소이거나 overload으로 배정된 풀 주소여야 한다
    if (ipv4.destinationIp !== iface.ip && assigned === undefined) return undefined;
    let binding: NatBinding | undefined;
    let newIcmp = icmp;
    if (tcp !== undefined) {
      binding = this.#natOutside.get(`tcp:${ipv4.destinationIp}:${ipv4.sourceIp}:${tcp.sourcePort}:${tcp.destinationPort}`);
    } else if (udp !== undefined) {
      binding = this.#natOutside.get(`udp:${ipv4.destinationIp}:${ipv4.sourceIp}:${udp.sourcePort}:${udp.destinationPort}`);
    } else if (icmp?.type === "echo-reply") {
      binding = this.#natOutside.get(`icmp:${ipv4.destinationIp}:${ipv4.sourceIp}:0:${icmp.sequence}`);
    } else if (isIcmpError(icmp)) {
      // 인용된 패킷은 출발지가 NAT 주소다. TCP·UDP는 안쪽 출발지 포트를 모르니 느슨한 색인을 쓴다
      const o = icmp.original;
      binding = o.protocol === undefined
        ? this.#natOutside.get(`icmp:${o.sourceIp}:${o.destinationIp}:0:${o.sequence}`)
        : this.#natLoose.get(`${o.protocol}:${o.sourceIp}:${o.destinationIp}:${o.destinationPort}`);
      if (binding !== undefined) {
        // 받는 호스트가 자기가 보낸 패킷으로 알아보게, 인용 안의 출발지도 안쪽 주소로 되돌린다
        newIcmp = { ...icmp, original: { ...o, sourceIp: binding.insideIp } };
      }
    }
    if (binding === undefined) return undefined;
    binding.lastSeen = this.#now();
    const layers = transportLayersOf(frame.snapshot);
    const snapshot: FrameSnapshot = {
      ...frame.snapshot,
      ipv4: { ...ipv4, destinationIp: binding.insideIp },
      ...(newIcmp === undefined ? {} : { icmp: newIcmp }),
      ...(tcp === undefined ? {} : { tcp: { ...layers.tcp!, destinationPort: binding.insidePort } }),
      ...(udp === undefined ? {} : { udp: { ...layers.udp!, destinationPort: binding.insidePort } }),
    };
    const next = ctx.updateFrame(frame, snapshot);
    const seq = ctx.record({ frame: next, deviceId: device.id, inPort: port, layer: "L3", action: "forward", parentSeq: received,
      reason: { code: "NAT_TRANSLATED", params: {
        device: deviceRef(device), direction: "outside-to-inside",
        insideIp: binding.insideIp, outsideIp: binding.outsideIp, peerIp: binding.peerIp,
        ...(binding.protocol === "icmp" ? { protocol: "icmp" as const } : { protocol: binding.protocol, port: binding.natPort }),
      } } });
    return { ipv4: { ...ipv4, destinationIp: binding.insideIp }, icmp: newIcmp, frame: next, seq };
  }

  /** 유휴가 NAT_IDLE_US를 넘은 바인딩과 풀 배정을 색인에서 함께 지운다. 변환 경로마다 부른다 */
  #natSweep(): void {
    const cutoff = this.#now() - NAT_IDLE_US;
    for (const [key, binding] of this.#natInside) {
      if (binding.lastSeen >= cutoff) continue;
      this.#natInside.delete(key);
      this.#natOutside.delete(`${binding.protocol}:${binding.outsideIp}:${binding.peerIp}:${binding.peerPort}:${binding.natPort}`);
      this.#natLoose.delete(`${binding.protocol}:${binding.outsideIp}:${binding.peerIp}:${binding.peerPort}`);
    }
    for (const [key, addr] of this.#natAddr) {
      if (addr.lastSeen >= cutoff) continue;
      // overload 배정은 그 주소를 쓰는 바인딩이 남아 있으면 해제하지 않는다
      if (addr.overload && [...this.#natInside.values()].some(b => b.outsideIp === addr.ip)) continue;
      this.#natAddr.delete(key);
      this.#natAddrByIp.delete(addr.ip);
    }
  }

  /** 범위에서 insideIp에 바깥 주소를 배정한다. overload이면 고갈 시 범위의 첫 주소를 나눠 쓴다 (T16.3) */
  #natAssign(device: RouterDevice, range: { startIp: string; endIp: string }, overload: boolean, insideIp: string): NatAddr | undefined {
    const existing = this.#natAddr.get(insideIp);
    if (existing !== undefined) { existing.lastSeen = this.#now(); return existing; }
    const start = parseIpv4(range.startIp)!;
    const end = parseIpv4(range.endIp)!;
    const reserved = new Set<string>([
      ...Object.values(device.config.interfaces).map(iface => iface.ip).filter((ip): ip is string => ip !== undefined),
      ...(device.config.natStatics ?? []).map(entry => entry.outsideIp),
      ...[...this.#natAddr.values()].map(addr => addr.ip),
    ]);
    for (let address = start; address <= end; address += 1) {
      const ip = formatIpv4(address);
      if (reserved.has(ip)) continue;
      const addr: NatAddr = { insideIp, ip, overload, lastSeen: this.#now() };
      this.#natAddr.set(insideIp, addr);
      this.#natAddrByIp.set(ip, addr);
      return addr;
    }
    // overload은 주소를 나눠 쓸 수 있다 — 고갈이면 첫 주소를 쓴다
    return overload ? { insideIp, ip: range.startIp, overload: true, lastSeen: this.#now() } : undefined;
  }

  /**
   * SNAT (T16.2). `nat outside`인 포트로 나가는 패킷은 출발지를 그 인터페이스 IP로, 논리 포트를
   * 새 natPort로 바꾸고 바인딩을 남긴다. 라우터 자기 주소에서 온 패킷은 바꾸지 않는다.
   */
  #snat(ctx: SimContext, device: RouterDevice, port: string, ipv4: Ipv4Header, icmp: IcmpMessage | undefined, frame: Frame, received: number):
    { readonly ipv4: Ipv4Header; readonly icmp: IcmpMessage | undefined; readonly frame: Frame; readonly seq: number } | undefined {
    const iface = device.config.interfaces[port];
    if (iface?.nat !== "outside" || iface.ip === undefined || !iface.adminUp) return undefined;
    const ownIps = new Set(Object.values(routerInterfaces(device.config)).map(candidate => candidate.ip));
    if (ownIps.has(ipv4.sourceIp)) return undefined;
    this.#natSweep();
    const { tcp, udp } = frame.snapshot;
    // 정적 대응: 출발지가 static의 안쪽 주소면 바깥 주소로 바꾼다. 포트는 그대로 두고 바인딩도 남기지 않는다
    const statik = (device.config.natStatics ?? []).find(entry => entry.insideIp === ipv4.sourceIp);
    if (statik !== undefined) {
      const snapshot: FrameSnapshot = { ...frame.snapshot, ipv4: { ...ipv4, ttl: ipv4.ttl - 1, sourceIp: statik.outsideIp } };
      const next = ctx.updateFrame(frame, snapshot);
      const seq = ctx.record({ frame: next, deviceId: device.id, inPort: port, layer: "L3", action: "forward", parentSeq: received,
        reason: { code: "NAT_TRANSLATED", params: {
          device: deviceRef(device), direction: "inside-to-outside",
          insideIp: statik.insideIp, outsideIp: statik.outsideIp, peerIp: ipv4.destinationIp,
          ...(tcp !== undefined ? { protocol: "tcp" as const, port: tcp.sourcePort }
            : udp !== undefined ? { protocol: "udp" as const, port: udp.sourcePort } : { protocol: "icmp" as const }),
        } } });
      return { ipv4: snapshot.ipv4!, icmp, frame: next, seq };
    }
    // 규칙 선택 (T16.3): natSources가 없으면 나가는 인터페이스로 묵시적 PAT(기존 동작).
    // 규칙이 있으면 ACL을 허락한 첫 규칙만 변환하고, 어느 규칙도 맞지 않으면 변환 없이 보낸다.
    const rules = device.config.natSources ?? [];
    let outsideIp: string;
    let overload = true;
    if (rules.length === 0) {
      outsideIp = iface.ip;
    } else {
      const rule = rules.find(candidate => natRuleMatches(device.config, candidate, ipv4.sourceIp));
      if (rule === undefined) return undefined;
      overload = rule.overload;
      const range = natPoolRangeOf(device.config, rule);
      if (range !== undefined) {
        const addr = this.#natAssign(device, range, rule.overload, ipv4.sourceIp);
        if (addr === undefined) return undefined; // 풀 고갈 — 변환 없이 보낸다
        outsideIp = addr.ip;
      } else if (rule.interface !== undefined) {
        const target = device.config.interfaces[rule.interface];
        if (target?.ip === undefined || !target.adminUp) return undefined;
        outsideIp = target.ip;
      } else {
        return undefined; // 대상이 없는 규칙 — 변환 없이 보낸다
      }
    }
    if (!overload) {
      // 동적 NAT 1:1 — 출발지 주소만 풀 주소로 바꾸고 포트는 그대로 둔다. 응답은 주소 배정이 되돌린다
      const snapshot: FrameSnapshot = { ...frame.snapshot, ipv4: { ...ipv4, ttl: ipv4.ttl - 1, sourceIp: outsideIp } };
      const next = ctx.updateFrame(frame, snapshot);
      const seq = ctx.record({ frame: next, deviceId: device.id, inPort: port, layer: "L3", action: "forward", parentSeq: received,
        reason: { code: "NAT_TRANSLATED", params: {
          device: deviceRef(device), direction: "inside-to-outside",
          insideIp: ipv4.sourceIp, outsideIp, peerIp: ipv4.destinationIp,
          ...(tcp !== undefined ? { protocol: "tcp" as const, port: tcp.sourcePort }
            : udp !== undefined ? { protocol: "udp" as const, port: udp.sourcePort } : { protocol: "icmp" as const }),
        } } });
      return { ipv4: snapshot.ipv4!, icmp, frame: next, seq };
    }
    let protocol: NatBinding["protocol"] = "icmp";
    let insidePort = icmp?.sequence ?? 0;
    let peerPort = 0;
    if (tcp !== undefined) { protocol = "tcp"; insidePort = tcp.sourcePort; peerPort = tcp.destinationPort; }
    else if (udp !== undefined) { protocol = "udp"; insidePort = udp.sourcePort; peerPort = udp.destinationPort; }
    const insideKey = `${protocol}:${ipv4.sourceIp}:${insidePort}:${ipv4.destinationIp}:${peerPort}`;
    let binding = this.#natInside.get(insideKey);
    if (binding === undefined) {
      const natPort = protocol === "icmp" ? insidePort : this.#natNextPort++;
      binding = { protocol, insideIp: ipv4.sourceIp, insidePort, peerIp: ipv4.destinationIp, peerPort,
        outsideIp, natPort, lastSeen: 0 };
      this.#natInside.set(insideKey, binding);
      this.#natOutside.set(`${protocol}:${outsideIp}:${binding.peerIp}:${binding.peerPort}:${binding.natPort}`, binding);
      this.#natLoose.set(`${protocol}:${outsideIp}:${binding.peerIp}:${binding.peerPort}`, binding);
    }
    binding.lastSeen = this.#now();
    const layers = transportLayersOf(frame.snapshot);
    const snapshot: FrameSnapshot = {
      ...frame.snapshot,
      ipv4: { ...ipv4, ttl: ipv4.ttl - 1, sourceIp: outsideIp },
      ...(tcp === undefined ? {} : { tcp: { ...layers.tcp!, sourcePort: binding.natPort } }),
      ...(udp === undefined ? {} : { udp: { ...layers.udp!, sourcePort: binding.natPort } }),
    };
    const next = ctx.updateFrame(frame, snapshot);
    const seq = ctx.record({ frame: next, deviceId: device.id, inPort: port, layer: "L3", action: "forward", parentSeq: received,
      reason: { code: "NAT_TRANSLATED", params: {
        device: deviceRef(device), direction: "inside-to-outside",
        insideIp: binding.insideIp, outsideIp: binding.outsideIp, peerIp: binding.peerIp,
        ...(binding.protocol === "icmp" ? { protocol: "icmp" as const } : { protocol: binding.protocol, port: binding.natPort }),
      } } });
    return { ipv4: snapshot.ipv4!, icmp, frame: next, seq };
  }

  #send(ctx: SimContext, decision: RouteDecision, ipv4: Ipv4Header, icmp: IcmpMessage | undefined,
    action: "forward" | "reply" | "create", parentSeq?: number, originalFrame?: Frame, inPort?: string): void {
    const device = this.#device();
    const { port, nextHop } = decision;
    if (ipv4.protocol !== 50) {
      const profile = this.#ipsec.outbound(ipv4);
      if (profile !== undefined) { this.#protect(ctx, profile, decision, ipv4, icmp, parentSeq, originalFrame); return; }
    }
    if (isTunnelName(port)) { this.#encapsulate(ctx, port, ipv4, icmp, parentSeq, originalFrame); return; }
    // 루프백의 연결망으로 보내는 패킷은 나가는 링크가 없어 그 자리에서 버려진다 (T0.57)
    if (isLoopbackName(port)) {
      const frame = originalFrame ?? ctx.createFrame({
        ethernet: { sourceMac: portMac(device, PORT_NAMES.router[0]), destinationMac: UNKNOWN_MAC }, ipv4,
        ...(icmp === undefined ? {} : { icmp }) });
      ctx.record({ frame, deviceId: device.id, layer: "L3", action: "drop",
        ...(parentSeq === undefined ? {} : { parentSeq }),
        reason: { code: "NOT_FOR_ME", params: { device: deviceRef(device) } } });
      return;
    }
    const gre = ipv4.protocol === 47 ? originalFrame?.snapshot.gre : undefined;
    const esp = ipv4.protocol === 50 ? originalFrame?.snapshot.esp : undefined;
    const pending: PendingSend = {
      ...(originalFrame === undefined ? {} : { originalFrame }),
      build: (destinationMac): FrameSnapshot => ({
        ethernet: { sourceMac: portMac(device, port), destinationMac }, ipv4,
        ...(icmp === undefined ? {} : { icmp }), ...(gre === undefined ? {} : { gre }), ...(esp === undefined ? {} : { esp }),
        // 전달하는 패킷의 TCP·UDP와 응용 계층은 그대로 옮긴다 (T0.20)
        ...(originalFrame === undefined ? {} : transportLayersOf(originalFrame.snapshot)),
      }),
      onSend: (context, frame, cause) => {
        const linkId = portLink(this.#getDocument(), { deviceId: device.id, port })?.linkId;
        const params = { device: deviceRef(device), sourceIp: ipv4.sourceIp, targetIp: ipv4.destinationIp };
        context.record({ frame, deviceId: device.id, outPort: port, ...(inPort === undefined ? {} : { inPort }),
          ...(linkId === undefined ? {} : { linkId }), ...(cause === undefined ? {} : { parentSeq: cause }),
          layer: action === "forward" ? "L3" : "ICMP", action,
          reason: action === "forward" ? { code: "IPV4_FORWARDED", params: { ...params, port, nextHop, ttl: ipv4.ttl } }
            : isIcmpError(icmp) ? { code: "ICMP_ERROR_SENT", params: { ...params, error: icmp.type } }
            : action === "create" ? { code: "ICMP_ECHO_REQUEST_SENT", params } : { code: "ICMP_ECHO_REPLY_SENT", params },
        });
      },
    };
    this.#arps.get(port)!.send(ctx, port, nextHop, pending, parentSeq);
  }

  #rejectIpsec(ctx: SimContext, frame: Frame, profile: string, detail: string, parentSeq?: number): void {
    this.#ipsec.reject(profile, ctx.now());
    ctx.record({ frame, deviceId: this.deviceId, layer: "IPSEC", action: "drop", reason: {
      code: "IPSEC_REJECTED", params: { device: deviceRef(this.#device()), profile, detail },
    }, ...(parentSeq === undefined ? {} : { parentSeq }) });
  }

  #protect(ctx: SimContext, name: string, decision: RouteDecision, ipv4: Ipv4Header, icmp: IcmpMessage | undefined,
    parentSeq?: number, original?: Frame): void {
    const device = this.#device(); const profile = device.config.ipsec![name]!;
    const inner = original ?? ctx.createFrame({ ethernet: { sourceMac: UNKNOWN_MAC, destinationMac: UNKNOWN_MAC }, ipv4,
      ...(icmp === undefined ? {} : { icmp }) });
    const outerRoute = profile.peer === undefined ? null : this.#decision(profile.peer);
    const source = profile.interface === undefined ? undefined : device.config.interfaces[profile.interface];
    if (outerRoute === null || source?.ip === undefined || !source.adminUp || decision.port !== profile.interface ||
      outerRoute.port !== profile.interface || isTunnelName(outerRoute.port)) {
      this.#rejectIpsec(ctx, inner, name, "출구/peer 물리 경로가 없거나 정책 인터페이스와 다릅니다", parentSeq); return;
    }
    const result = this.#ipsec.protect(name, ipv4, icmp, ctx.now());
    if (!result.ok) { this.#rejectIpsec(ctx, inner, name, result.detail, parentSeq); return; }
    const outer = ctx.updateFrame(inner, { ethernet: inner.snapshot.ethernet,
      ipv4: { sourceIp: source.ip, destinationIp: profile.peer!, ttl: this.#ttl(), protocol: 50 }, esp: result.value });
    const protectedSeq = ctx.record({ frame: outer, deviceId: device.id, layer: "IPSEC", action: "create", reason: {
      code: "IPSEC_PROTECTED", params: { device: deviceRef(device), profile: name, peer: profile.peer!, spi: result.value.spi, sequence: result.value.sequence },
    }, ...(parentSeq === undefined ? {} : { parentSeq }) });
    this.#send(ctx, outerRoute, outer.snapshot.ipv4!, undefined, "forward", protectedSeq, outer);
  }

  #unprotect(ctx: SimContext, port: string, frame: Frame, parentSeq: number): void {
    const { esp, ipv4 } = frame.snapshot;
    const name = esp === undefined || ipv4 === undefined ? undefined : this.#ipsec.inbound(ipv4, esp, port);
    if (esp === undefined || ipv4 === undefined || name === undefined) {
      this.#rejectIpsec(ctx, frame, "", "수신 SA가 없습니다 (peer/바깥 IP/port/SPI 불일치)", parentSeq); return;
    }
    const result = this.#ipsec.unprotect(name, ipv4, esp, port, ctx.now());
    if (!result.ok) { this.#rejectIpsec(ctx, frame, name, result.detail, parentSeq); return; }
    const restored = ctx.updateFrame(frame, { ethernet: frame.snapshot.ethernet, ipv4: result.value.ipv4, icmp: result.value.icmp });
    const received = ctx.record({ frame: restored, deviceId: this.deviceId, inPort: port, layer: "IPSEC", action: "receive", parentSeq,
      reason: { code: "IPSEC_UNPROTECTED", params: { device: deviceRef(this.#device()), profile: name, peer: ipv4.sourceIp, spi: esp.spi, sequence: esp.sequence } } });
    this.#receiveIp(ctx, port, restored, received, name);
  }

  #rejectGre(ctx: SimContext, frame: Frame, detail: string, parentSeq?: number): void {
    ctx.record({ frame, deviceId: this.deviceId, layer: "GRE", action: "drop", reason: {
      code: "GRE_REJECTED", params: { device: deviceRef(this.#device()), detail },
    }, ...(parentSeq === undefined ? {} : { parentSeq }) });
  }

  #encapsulate(ctx: SimContext, name: string, ipv4: Ipv4Header, icmp: IcmpMessage | undefined, parentSeq?: number, original?: Frame): void {
    const device = this.#device(); const tunnel = device.config.tunnels?.[name];
    const source = tunnel?.source === undefined ? undefined : device.config.interfaces[tunnel.source];
    const inner = original === undefined ? ctx.createFrame({ ethernet: { sourceMac: UNKNOWN_MAC, destinationMac: UNKNOWN_MAC }, ipv4,
      ...(icmp === undefined ? {} : { icmp }) }) : original;
    const outerRoute = tunnel?.destination === undefined ? null : this.#decision(tunnel.destination);
    if (tunnel === undefined || !tunnel.adminUp || source?.ip === undefined || outerRoute === null ||
      isTunnelName(outerRoute.port) || ipv4.protocol === 47 || icmp === undefined) {
      this.#rejectGre(ctx, inner, "터널 미설정, underlay 재귀 경로 또는 중첩/미지원 payload", parentSeq); return;
    }
    const outer = ctx.updateFrame(inner, { ethernet: inner.snapshot.ethernet,
      ipv4: { sourceIp: source.ip, destinationIp: tunnel.destination!, ttl: this.#ttl(), protocol: 47 },
      gre: { version: 0, protocolType: 2048, payload: { ipv4, icmp } },
    });
    const wrapped = ctx.record({ frame: outer, deviceId: device.id, layer: "GRE", action: "create", reason: {
      code: "GRE_ENCAPSULATED", params: { device: deviceRef(device), tunnel: name, peer: tunnel.destination! },
    }, ...(parentSeq === undefined ? {} : { parentSeq }) });
    this.#send(ctx, outerRoute, outer.snapshot.ipv4!, undefined, "forward", wrapped, outer);
  }

  #decapsulate(ctx: SimContext, port: string, frame: Frame, parentSeq: number): void {
    const { gre, ipv4 } = frame.snapshot; const device = this.#device();
    const ports = portViewsOf(this.#getDocument(), device);
    const state = tunnelStates(device.config, ports, this.#rip.routes()).find(state => state.status === "up" &&
      state.sourceIp === ipv4?.destinationIp && state.destination === ipv4?.sourceIp);
    if (gre === undefined || ipv4?.protocol !== 47 || gre.version !== 0 || gre.protocolType !== 2048 || state === undefined ||
      gre.payload.ipv4.protocol !== undefined || gre.payload.ipv4.destinationIp === ipv4.sourceIp) {
      this.#rejectGre(ctx, frame, "수신 GRE 형식/상대/터널 상태가 일치하지 않습니다", parentSeq); return;
    }
    const restored = ctx.updateFrame(frame, { ethernet: frame.snapshot.ethernet, ipv4: gre.payload.ipv4, icmp: gre.payload.icmp });
    const received = ctx.record({ frame: restored, deviceId: device.id, inPort: port, layer: "GRE", action: "receive", parentSeq,
      reason: { code: "GRE_DECAPSULATED", params: { device: deviceRef(device), tunnel: state.name, peer: ipv4.sourceIp } } });
    // 논리 인터페이스 수신부터 기존 로컬 응답/경로 조회/TTL/오류 처리를 재사용한다.
    this.#receiveIp(ctx, state.name, restored, received);
  }

  #unicast(ip: string): boolean {
    if (checkHostIpv4(ip) !== null) return false;
    return !Object.values(routerInterfaces(this.#device().config)).some(iface => {
      // 자기 인터페이스의 네트워크·브로드캐스트 주소는 유니캐스트가 아니다.
      // /31·/32(루프백)에는 그런 주소가 없으니 건너뛴다 (T0.57)
      if (iface.ip === undefined || iface.mask === undefined) return false;
      const length = maskToPrefixLength(iface.mask);
      return length !== null && length <= 30 && isSameNetwork(ip, iface.ip, iface.mask) &&
        checkInterfaceAddress(ip, iface.mask) !== null;
    });
  }

  #error(ctx: SimContext, original: Frame, type: IcmpErrorType, parentSeq: number): void {
    const { ipv4, icmp, tcp, udp, ethernet } = original.snapshot;
    // TCP·UDP 패킷에도 답한다 (T0.20). 오류에 프로토콜과 목적지 포트를 담아 보낸 쪽이 어느 요청인지 안다
    const transport = tcp ?? udp;
    // ICMP 오류에 다시 오류를 만들지 않는다. 브로드캐스트·잘못된 주소에도 응답하지 않는다.
    if (ipv4 === undefined || (icmp === undefined && transport === undefined) || isIcmpError(icmp) ||
      ethernet.destinationMac === BROADCAST_MAC || !this.#unicast(ipv4.sourceIp) || !this.#unicast(ipv4.destinationIp)) return;
    const sequence = icmp?.sequence ?? 0;
    const device = this.#device();
    const localInterface = Object.entries(routerInterfaces(device.config)).find(([name, iface]) =>
      (!isTunnelName(name) || greEnabled(device.config)) && iface.adminUp && iface.ip === ipv4.sourceIp)?.[0];
    const localPort = localInterface === undefined ? undefined : isTunnelName(localInterface)
      ? device.config.tunnels?.[localInterface]?.source
      : isLoopbackName(localInterface) ? PORT_NAMES.router[0] : localInterface;
    const message: IcmpMessage = { type, sequence, original: {
      sourceIp: ipv4.sourceIp, destinationIp: ipv4.destinationIp, sequence,
      ...(icmp !== undefined || transport === undefined ? {} : {
        protocol: tcp === undefined ? "udp" as const : "tcp" as const, destinationPort: transport.destinationPort,
      }),
    } };
    if (localPort !== undefined) {
      // 원래 출발지가 자신이면 ICMP 오류를 로컬 전달한다. 자기 주소를 ARP로 조회하거나 링크로 내보내지 않는다.
      const frame = ctx.createFrame({
        ethernet: { sourceMac: portMac(device, localPort), destinationMac: portMac(device, localPort) },
        ipv4: { sourceIp: ipv4.sourceIp, destinationIp: ipv4.sourceIp, ttl: this.#ttl() }, icmp: message,
      });
      const params = { device: deviceRef(device), sourceIp: ipv4.sourceIp, targetIp: ipv4.sourceIp, error: type };
      const sent = ctx.record({ frame, deviceId: device.id, layer: "ICMP", action: "reply", parentSeq,
        reason: { code: "ICMP_ERROR_SENT", params } });
      ctx.record({ frame, deviceId: device.id, layer: "ICMP", action: "receive", parentSeq: sent,
        reason: { code: "ICMP_ERROR_RECEIVED", params } });
      return;
    }
    const decision = this.#decision(ipv4.sourceIp);
    if (decision === null) return;
    this.#send(ctx, decision, {
      sourceIp: this.#ipsec.sourceFor(ipv4.sourceIp) ?? routerInterfaces(this.#device().config)[decision.port]!.ip!, destinationIp: ipv4.sourceIp, ttl: this.#ttl(),
    }, message, "reply", parentSeq);
  }

  /**
   * 자기 주소로 온 TCP/22 — SSH 수신이 켜져 있을 때 (T0.56).
   * SYN에 SYN-ACK, 응용 데이터에 배너 응답을 돌려준다. 세션 상태는 두지 않는다 (TransportHost의 서버 쪽과 같은 단순화)
   */
  #sshReceive(ctx: SimContext, port: string, frame: Frame, parentSeq: number, ipv4: Ipv4Header, tcp: { sourcePort: number; destinationPort: number; flags: TcpFlags }): void {
    const device = this.#device();
    const ref = deviceRef(device);
    const peer = ipv4.sourceIp;
    // 서버가 받을 것은 SYN, ACK, 요청(PSH-ACK)뿐이다. 그 밖의 것은 이미 끝난 요청의 것이다
    if (tcp.flags === "SYN-ACK" || tcp.flags === "RST") return;
    const base = { frame, deviceId: device.id, inPort: port };
    const application = frame.snapshot.application;
    let receivedSeq: number;
    if (application === undefined) {
      receivedSeq = ctx.record({ ...base, layer: "TCP", action: "receive", parentSeq,
        reason: { code: "TCP_SEGMENT_RECEIVED", params: {
          device: ref, sourceIp: peer, targetIp: ipv4.destinationIp, port: tcp.destinationPort, flags: tcp.flags,
        } } });
      if (tcp.flags === "ACK") return;
    } else {
      receivedSeq = ctx.record({ ...base, layer: "APP", action: "receive", parentSeq,
        reason: { code: "SERVICE_REQUEST_RECEIVED", params: {
          device: ref, service: application.service, sourceIp: peer, targetIp: ipv4.destinationIp, port: tcp.destinationPort,
          message: application.message,
        } } });
    }
    if (application === undefined) {
      this.#sshSend(ctx, ipv4.destinationIp, peer, tcp.sourcePort, "SYN-ACK", undefined, receivedSeq);
      return;
    }
    this.#sshSend(ctx, ipv4.destinationIp, peer, tcp.sourcePort, "PSH-ACK",
      { service: application.service, message: "SSH-2.0-OpenSSH_PING9" }, receivedSeq);
  }

  /** SSH 응답 세그먼트를 경로 조회·ARP로 내보낸다. `sourceIp`는 요청이 온 라우터 주소다 */
  #sshSend(
    ctx: SimContext, sourceIp: string, targetIp: string, destinationPort: number,
    flags: TcpFlags, application: ApplicationData | undefined, parentSeq?: number,
  ): void {
    const device = this.#device();
    const decision = this.#decision(targetIp);
    if (decision === null) return;
    const ref = deviceRef(device);
    const pending: PendingSend = {
      build: (destinationMac): FrameSnapshot => ({
        ethernet: { sourceMac: portMac(device, decision.port), destinationMac },
        ipv4: { sourceIp, destinationIp: targetIp, ttl: this.#ttl() },
        tcp: { sourcePort: SSH_PORT, destinationPort, flags },
        ...(application === undefined ? {} : { application }),
      }),
      onSend: (context, out, cause) => {
        const params = { device: ref, sourceIp, targetIp, port: SSH_PORT };
        context.record({ frame: out, deviceId: device.id, outPort: decision.port,
          layer: application === undefined ? "TCP" : "APP", action: "reply",
          ...(cause === undefined ? {} : { parentSeq: cause }),
          reason: application === undefined
            ? { code: "TCP_SEGMENT_SENT", params: { ...params, flags } }
            : { code: "SERVICE_RESPONSE_SENT", params: { ...params, service: application.service, message: application.message } },
        });
      },
    };
    this.#arps.get(decision.port)!.send(ctx, decision.port, decision.nextHop, pending, parentSeq);
  }

  onTimer(ctx: SimContext, timer: TimerRef): void {
    for (const arp of this.#arps.values()) arp.onTimer(ctx, timer);
    this.#rip.onTimer(ctx, timer);
  }

  startRun(): void {
    for (const arp of this.#arps.values()) arp.discardPending();
    this.#replies.clear();
  }

  repliesReceived(): readonly number[] { return [...this.#replies]; }

  /** 이 라우터가 직접 만드는 패킷의 TTL — 콘솔 스타일에 따른다 (T16.2) */
  #ttl(): number { return routerTtlOf(this.#device().config.cliStyle); }

  /** echo 요청을 보낸다. `ttl`은 traceroute가 hop마다 정한다 (T11.4.1) */
  sendEcho(ctx: SimContext, targetIp: string, sequence: number, ttl = this.#ttl()): void {
    const device = this.#device(); const decision = this.#decision(targetIp);
    if (decision === null) {
      const port = PORT_NAMES.router[0];
      const frame = ctx.createFrame({ ethernet: { sourceMac: portMac(device, port), destinationMac: UNKNOWN_MAC },
        ipv4: { sourceIp: device.config.interfaces[port]?.ip ?? "", destinationIp: targetIp, ttl },
        icmp: { type: "echo-request", sequence } });
      ctx.record({ frame, deviceId: device.id, layer: "L3", action: "drop",
        reason: { code: "NO_ROUTE", params: { device: deviceRef(device), targetIp } } });
      return;
    }
    this.#send(ctx, decision, { sourceIp: this.#ipsec.sourceFor(targetIp) ?? routerInterfaces(device.config)[decision.port]!.ip!, destinationIp: targetIp, ttl },
      { type: "echo-request", sequence }, "create");
  }

  arpTable() { return [...this.#arps.values()].flatMap(arp => arp.view()); }

  clearArp(ip?: string): void { for (const arp of this.#arps.values()) arp.clear(ip); }

  onConfigChanged(change: ConfigChange): void {
    const before = routerIn(change.previous, this.deviceId);
    const after = routerIn(change.document, this.deviceId);
    if (before === undefined || after === undefined) return;
    this.#ipsec.configChanged(before.config);
    // RIP 구성이 바뀌면 다음 경로 교환까지 배운 경로를 쓰지 않는다 (T11.2.2 결정 7)
    if (JSON.stringify(before.config.rip) !== JSON.stringify(after.config.rip)) this.#rip.clear();
    for (const port of PORT_NAMES.router) {
      const old = before.config.interfaces[port]; const now = after.config.interfaces[port];
      const ref = { deviceId: this.deviceId, port };
      const linkBefore = portLink(change.previous, ref); const linkNow = portLink(change.document, ref);
      if (old?.ip !== now?.ip || old?.mask !== now?.mask || old?.adminUp !== now?.adminUp ||
        linkBefore?.linkId !== linkNow?.linkId || linkBefore?.peer.deviceId !== linkNow?.peer.deviceId ||
        linkBefore?.peer.port !== linkNow?.peer.port ||
        (linkNow !== undefined && findDevice(change.document, linkNow.peer.deviceId) !== undefined &&
          !isAdminUp(findDevice(change.document, linkNow.peer.deviceId)!, linkNow.peer.port))) {
        this.#arps.get(port)!.onPortChanged(port);
      }
    }
    this.startRun();
  }

  ipsecSa() { return this.#ipsec.view(portViewsOf(this.#getDocument(), this.#device()), this.#now()); }

  view(): RouterView {
    const device = this.#device(); const ports = portViewsOf(this.#getDocument(), device);
    return { kind: "router", ports, arpTable: this.arpTable(), routingTable: routingTable(device.config, ports, this.#rip.routes()),
      ...(device.config.ipsec === undefined ? {} : { ipsec: this.#ipsec.view(ports, this.#now()) }),
      ...(device.config.tunnels === undefined ? {} : { tunnels: tunnelStates(device.config, ports, this.#rip.routes()) }) };
  }
}
