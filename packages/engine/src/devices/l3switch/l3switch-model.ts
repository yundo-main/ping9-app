// T0.33: L3 Switch 모델. 스위치의 L2 전달과 라우터의 L3 전달을 한 장비에 넣는다.
// - 라우티드 포트(`no switchport`)로 들어온 프레임은 L2를 거치지 않고 바로 L3다.
// - L2 포트로 들어와 목적지 MAC이 시스템 MAC이면 그 VLAN의 SVI가 받는다 (게이트웨이).
//   브로드캐스트는 L2로 플러딩하면서도, 내 SVI를 묻는 ARP 요청·RIP 멀티캐스트는 L3에 사본을 준다.
// 모든 L3 인터페이스는 시스템 MAC 하나를 쓴다 (실제 Catalyst의 SVI가 그렇다).
// 구성은 매번 지금 Document에서 읽고, 동적 상태(MAC 표·ARP 표·RIP)만 모델이 들고 있다.

import { BROADCAST_MAC, PORT_NAMES, RIP_MULTICAST_MAC, UNKNOWN_MAC, checkHostIpv4, checkInterfaceAddress, isIcmpError, isSameNetwork, isSviName, sviVlan } from "@ping9/shared";
import type { DeviceView, DropReason, FrameSnapshot, IcmpErrorType, IcmpMessage, Ipv4Header, L3SwitchDevice, L3SwitchView, Reason, TopologyDocument } from "@ping9/shared";

import type { Frame, SimContext, TimerRef } from "../../kernel";
import { deviceRef, findDevice, isAdminUp, portLink, portMac } from "../../topology";
import { portViewsOf } from "../../views";
import { transmit } from "../link";
import type { ConfigChange, DeviceModel } from "../model";
import { ArpModule } from "../../protocols/arp";
import type { PendingSend } from "../../protocols/arp";
import { transportLayersOf } from "../../protocols/transport";
import { RipModule } from "../router/rip";
import { lookupRoute } from "../router/routing";
import type { RouteDecision, RoutingEntry } from "../router/routing";
import { EMPTY_MAC_TABLE, egress, macTableView, pruneMacTable, switchForward } from "../switch/forwarding";
import type { MacTable } from "../switch/forwarding";
import { l3InterfaceStates, l3RoutingTable } from "./l3-routing";

/** L3 스위치가 직접 만드는 패킷의 TTL — IOS 콘솔이라 시스코처럼 255다 */
const TTL = 255;

function l3In(document: TopologyDocument, deviceId: string): L3SwitchDevice | undefined {
  const device = findDevice(document, deviceId);
  return device?.kind === "l3switch" ? device : undefined;
}

/** 포트 상태는 화면과 같은 계산으로 읽는다 (AD-7) */
function portUpChecker(document: TopologyDocument, device: L3SwitchDevice): (port: string) => boolean {
  const ports = portViewsOf(document, device);
  return (port) => ports.find((candidate) => candidate.name === port)?.status === "up";
}

export class L3SwitchModel implements DeviceModel {
  readonly deviceId: string;
  readonly #getDocument: () => TopologyDocument;
  readonly #now: () => number;
  #table: MacTable = EMPTY_MAC_TABLE;
  /** L3 인터페이스(SVI 이름 또는 라우티드 포트)별 ARP 모듈. 쓸 때 만든다 */
  readonly #arps = new Map<string, ArpModule>();
  readonly #rip: RipModule;
  readonly #replies = new Set<number>();

  constructor(deviceId: string, getDocument: () => TopologyDocument, now: () => number) {
    this.deviceId = deviceId;
    this.#getDocument = getDocument;
    this.#now = now;
    const current = () => this.#device();
    this.#rip = new RipModule({
      device: current,
      rip: () => current().config.rip,
      interfaces: () => l3InterfaceStates(current().config, portViewsOf(getDocument(), current()))
        .flatMap(state => {
          if (state.status !== "up" || state.ip === undefined || state.mask === undefined) return [];
          const network = l3RoutingTable(current().config, portViewsOf(getDocument(), current()))
            .find(route => route.source === "connected" && route.port === state.name)?.network;
          return network === undefined ? [] : [{ name: state.name, ip: state.ip, network, mask: state.mask }];
        }),
      macOf: () => portMac(current(), PORT_NAMES.l3switch[0]),
      linkOf: (iface) => isSviName(iface) ? undefined : portLink(getDocument(), { deviceId, port: iface })?.linkId,
      send: (ctx, iface, frame, sent) => this.#sendL2(ctx, iface, frame, sent),
    });
  }

  #device(): L3SwitchDevice {
    const device = l3In(this.#getDocument(), this.deviceId);
    if (device === undefined) throw new Error(`L3SwitchModel: l3switch ${this.deviceId} is not in the document`);
    return device;
  }

  /** 모든 L3 인터페이스가 나눠 쓰는 MAC. 첫 포트의 MAC을 시스템 MAC으로 쓴다 */
  #systemMac(): string {
    return portMac(this.#device(), PORT_NAMES.l3switch[0]);
  }

  /** L2에 쓰는 포트: 라우티드 포트는 빠진다 */
  #l2Ports(device: L3SwitchDevice): readonly string[] {
    return PORT_NAMES.l3switch.filter(port => device.config.ports[port]?.routed !== true);
  }

  /** 그 VLAN의 SVI 이름. 구성에 없으면 undefined */
  #sviForVlan(vlan: number): string | undefined {
    return Object.keys(this.#device().config.interfaces)
      .find(name => isSviName(name) && sviVlan(name) === vlan);
  }

  /** L3 인터페이스의 ARP 모듈. 없으면 만든다 */
  #arp(iface: string): ArpModule {
    let module = this.#arps.get(iface);
    if (module === undefined) {
      const current = () => this.#device();
      const getDocument = this.#getDocument;
      const deviceId = this.deviceId;
      module = new ArpModule({
        get device() { return deviceRef(current()); },
        ipOf: () => current().config.interfaces[iface]?.ip,
        macOf: () => portMac(current(), PORT_NAMES.l3switch[0]),
        linkOf: () => isSviName(iface) ? undefined : portLink(getDocument(), { deviceId, port: iface })?.linkId,
        transmit: (ctx, _port, frame) => this.#sendL2(ctx, iface, frame),
      });
      this.#arps.set(iface, module);
    }
    return module;
  }

  onFrame(ctx: SimContext, port: string, frame: Frame): void {
    const document = this.#getDocument();
    const device = this.#device();

    // 라우티드 포트: L2를 거치지 않고 라우터 포트처럼 받는다
    if (device.config.ports[port]?.routed === true) {
      this.#receiveRouted(ctx, port, frame);
      return;
    }

    const result = switchForward({
      config: device.config,
      isPortUp: portUpChecker(document, device),
      macTable: this.#table,
      now: ctx.now(),
      inPort: port,
      frame: frame.snapshot.ethernet,
      ports: this.#l2Ports(device),
      consumeMacs: [this.#systemMac()],
    });
    this.#table = result.macTable;
    const ref = deviceRef(device);

    if (result.ingressDrop !== undefined) {
      ctx.record({
        frame, deviceId: device.id, inPort: port, layer: "L2", action: "drop",
        reason: { code: result.ingressDrop.reason, params: { device: ref, ...result.ingressDrop.params } } as Reason<DropReason>,
      });
      return;
    }
    const vlan = result.vlan;
    if (vlan === undefined) throw new Error("switchForward: a frame that was not dropped has no VLAN");

    const receivedSeq = ctx.record({
      frame, deviceId: device.id, inPort: port, layer: "L2", action: "receive",
      reason: { code: "FRAME_RECEIVED", params: { device: ref, port } },
    });
    let causeSeq = receivedSeq;
    if (result.learned !== undefined) {
      causeSeq = ctx.record({
        frame, deviceId: device.id, inPort: port, layer: "L2", action: "learn",
        reason: { code: "MAC_LEARNED", params: { device: ref, ...result.learned } },
        parentSeq: receivedSeq,
      });
    }

    if (result.consumed === true) {
      // 게이트웨이 MAC으로 온 유니캐스트 — 그 VLAN의 SVI가 받는다
      this.#receiveL3(ctx, this.#sviForVlan(vlan), frame, causeSeq);
      return;
    }

    if (!result.samePort) {
      for (const output of result.outputs) {
        const outFrame = output.vlanTag === undefined ? frame : ctx.updateFrame(frame, {
          ...frame.snapshot,
          ethernet: { ...frame.snapshot.ethernet, vlanTag: output.vlanTag },
        });
        const linkId = portLink(document, { deviceId: this.deviceId, port: output.port })?.linkId;
        const seq = ctx.record({
          frame: outFrame, deviceId: device.id, inPort: port, outPort: output.port,
          ...(linkId === undefined ? {} : { linkId }),
          layer: "L2", action: "forward",
          reason: output.flooded
            ? { code: "FRAME_FLOODED", params: { device: ref, port: output.port, vlan, broadcast: frame.snapshot.ethernet.destinationMac === BROADCAST_MAC } }
            : { code: "FRAME_FORWARDED", params: { device: ref, mac: frame.snapshot.ethernet.destinationMac.toLowerCase(), port: output.port } },
          parentSeq: causeSeq,
        });
        transmit(ctx, document, { deviceId: this.deviceId, port: output.port }, outFrame, seq);
      }
      if (result.outputs.length === 0) {
        for (const blocked of result.blocked) {
          ctx.record({
            frame, deviceId: device.id, inPort: port, outPort: blocked.params.port, layer: "L2", action: "drop",
            reason: { code: blocked.reason, params: { device: ref, ...blocked.params } } as Reason<DropReason>,
            parentSeq: causeSeq,
          });
        }
      }
    }

    // 브로드캐스트·멀티캐스트는 CPU에도 사본이 간다 — 내 SVI를 묻는 ARP와 RIP는 L3가 답한다
    this.#l3Copies(ctx, device, vlan, frame);
  }

  /**
   * L2 플러딩과 별개로 L3에 주는 사본. 같은 VLAN의 SVI IP를 묻는 ARP 요청에는 SVI가 답하고,
   * RIP 멀티캐스트는 그 VLAN의 SVI가 참여하면 처리한다
   */
  #l3Copies(ctx: SimContext, device: L3SwitchDevice, vlan: number, frame: Frame): void {
    const arp = frame.snapshot.arp;
    if (arp?.operation === "request") {
      const svi = this.#sviForVlan(vlan);
      const iface = svi === undefined ? undefined : device.config.interfaces[svi];
      if (svi !== undefined && iface?.adminUp === true && iface.ip === arp.targetIp) {
        this.#arp(svi).onArp(ctx, svi, frame);
      }
      return;
    }
    if (frame.snapshot.rip !== undefined && frame.snapshot.ethernet.destinationMac === RIP_MULTICAST_MAC &&
      device.config.rip !== undefined) {
      const svi = this.#sviForVlan(vlan);
      if (svi !== undefined) this.#rip.onFrame(ctx, svi, frame);
    }
  }

  /** 라우티드 포트의 수신 — Router 모델의 포트 수신과 같다 */
  #receiveRouted(ctx: SimContext, port: string, frame: Frame): void {
    const device = this.#device();
    const ref = deviceRef(device);
    const drop = (reason: Reason<"IF_DOWN" | "NO_IP" | "NOT_FOR_ME">) => ctx.record({
      frame, deviceId: device.id, inPort: port, layer: reason.code === "NO_IP" ? "L3" : "L2", action: "drop", reason,
    });
    if (!isAdminUp(device, port)) { drop({ code: "IF_DOWN", params: { device: ref, port } }); return; }
    if (device.config.interfaces[port]?.ip === undefined) { drop({ code: "NO_IP", params: { device: ref } }); return; }
    const mac = frame.snapshot.ethernet.destinationMac;
    if (frame.snapshot.rip !== undefined && (mac === RIP_MULTICAST_MAC || mac === this.#systemMac())) {
      this.#rip.onFrame(ctx, port, frame);
      return;
    }
    if (mac !== this.#systemMac() && mac !== BROADCAST_MAC) {
      drop({ code: "NOT_FOR_ME", params: { device: ref } });
      return;
    }
    if (frame.snapshot.arp !== undefined) { this.#arp(port).onArp(ctx, port, frame); return; }
    this.#receiveIp(ctx, port, frame);
  }

  /** 내 MAC으로 소비된 프레임을 그 VLAN의 SVI에 넘긴다 */
  #receiveL3(ctx: SimContext, iface: string | undefined, frame: Frame, parentSeq: number): void {
    const device = this.#device();
    if (iface === undefined || device.config.interfaces[iface] === undefined) {
      ctx.record({
        frame, deviceId: device.id, layer: "L3", action: "drop", parentSeq,
        reason: { code: "NO_IP", params: { device: deviceRef(device) } },
      });
      return;
    }
    if (frame.snapshot.arp !== undefined) { this.#arp(iface).onArp(ctx, iface, frame); return; }
    if (frame.snapshot.rip !== undefined) { this.#rip.onFrame(ctx, iface, frame); return; }
    this.#receiveIp(ctx, iface, frame, undefined, parentSeq);
  }

  /** L3 인터페이스로 들어온 IPv4. `iface`는 SVI 이름 또는 라우티드 포트다 */
  #receiveIp(ctx: SimContext, iface: string, frame: Frame, inPort?: string, parentSeq?: number): void {
    const device = this.#device();
    const ref = deviceRef(device);
    const { ipv4, icmp } = frame.snapshot;
    if (ipv4 === undefined) return;
    if (!this.#unicast(ipv4.destinationIp)) {
      ctx.record({ frame, deviceId: device.id, inPort: iface, layer: "L3", action: "drop",
        reason: { code: "NOT_FOR_ME", params: { device: ref } } });
      return;
    }
    const received = ctx.record({
      frame, deviceId: device.id, inPort: iface, layer: "L3", action: "receive",
      ...(parentSeq === undefined ? {} : { parentSeq }),
      reason: { code: "IPV4_RECEIVED", params: { device: ref, sourceIp: ipv4.sourceIp, targetIp: ipv4.destinationIp } },
    });

    const local = Object.values(device.config.interfaces).some(candidate => candidate.adminUp && candidate.ip === ipv4.destinationIp);
    if (local) {
      if (icmp?.type === "echo-request") {
        const request = ctx.record({ frame, deviceId: device.id, inPort: iface, layer: "ICMP", action: "receive", parentSeq: received,
          reason: { code: "ICMP_ECHO_REQUEST_RECEIVED", params: { device: ref, sourceIp: ipv4.sourceIp, targetIp: ipv4.destinationIp } } });
        const decision = this.#decision(ipv4.sourceIp);
        if (decision !== null) this.#send(ctx, decision, {
          sourceIp: ipv4.destinationIp, destinationIp: ipv4.sourceIp, ttl: TTL,
        }, { type: "echo-reply", sequence: icmp.sequence }, "reply", request);
      } else if (isIcmpError(icmp)) {
        if (icmp.original.sourceIp !== ipv4.destinationIp || icmp.original.sequence !== icmp.sequence) return;
        ctx.record({ frame, deviceId: device.id, inPort: iface, layer: "ICMP", action: "receive", parentSeq: received,
          reason: { code: "ICMP_ERROR_RECEIVED", params: { device: ref, sourceIp: ipv4.sourceIp, targetIp: ipv4.destinationIp, error: icmp.type } } });
      } else if (icmp?.type === "echo-reply") {
        ctx.record({ frame, deviceId: device.id, inPort: iface, layer: "ICMP", action: "receive", parentSeq: received,
          reason: { code: "ICMP_ECHO_REPLY_RECEIVED", params: { device: ref, sourceIp: ipv4.sourceIp, targetIp: ipv4.destinationIp } } });
        this.#replies.add(icmp.sequence);
      } else if (icmp === undefined) {
        const transport = frame.snapshot.tcp ?? frame.snapshot.udp;
        if (transport === undefined) return;
        const closed = ctx.record({ frame, deviceId: device.id, inPort: iface, parentSeq: received,
          layer: frame.snapshot.tcp === undefined ? "UDP" : "TCP", action: "drop",
          reason: { code: "PORT_CLOSED", params: {
            device: ref, protocol: frame.snapshot.tcp === undefined ? "udp" : "tcp", port: transport.destinationPort,
          } } });
        this.#error(ctx, frame, "destination-unreachable", closed);
      }
      return;
    }

    // `no ip routing`이면 L3는 꺼져 있다 — 자기 것이 아닌 패킷은 버린다
    if (device.config.ipRouting !== true) {
      ctx.record({ frame, deviceId: device.id, inPort: iface, layer: "L3", action: "drop", parentSeq: received,
        reason: { code: "IP_FORWARD_DISABLED", params: { device: ref } } });
      return;
    }
    const decision = this.#decision(ipv4.destinationIp);
    if (ipv4.ttl <= 1 || decision === null) {
      const droppedFrame = ipv4.ttl <= 1 ? ctx.updateFrame(frame, { ...frame.snapshot, ipv4: { ...ipv4, ttl: 0 } }) : frame;
      const dropped = ctx.record({ frame: droppedFrame, deviceId: device.id, inPort: iface, layer: "L3", action: "drop", parentSeq: received,
        reason: ipv4.ttl <= 1 ? { code: "TTL_EXPIRED", params: { device: ref } }
          : { code: "NO_ROUTE", params: { device: ref, targetIp: ipv4.destinationIp } } });
      this.#error(ctx, frame, ipv4.ttl <= 1 ? "time-exceeded" : "destination-unreachable", dropped);
      return;
    }
    this.#send(ctx, decision, { ...ipv4, ttl: ipv4.ttl - 1 }, icmp, "forward", received, frame, inPort ?? iface);
  }

  #decision(destination: string): RouteDecision | null {
    const device = this.#device();
    const ports = portViewsOf(this.#getDocument(), device);
    return lookupRoute(l3RoutingTable(device.config, ports, this.#rip.routes()), destination);
  }

  /** 지금 쓰는 라우팅 테이블. 배운 RIP 경로를 포함한다 */
  routingTable(): readonly RoutingEntry[] {
    return l3RoutingTable(this.#device().config, portViewsOf(this.#getDocument(), this.#device()), this.#rip.routes());
  }

  /** 경로 교환 1회의 시작. RIP를 켠 L3 스위치만 보낸다 */
  startRipExchange(ctx: SimContext): void {
    this.#rip.startExchange(ctx);
  }

  /** 라우팅된 패킷 또는 내가 만드는 패킷을 나갈 인터페이스로 보낸다. ARP로 다음 홉 MAC을 구한다 */
  #send(ctx: SimContext, decision: RouteDecision, ipv4: Ipv4Header, icmp: IcmpMessage | undefined,
    action: "forward" | "reply" | "create", parentSeq?: number, originalFrame?: Frame, inPort?: string): void {
    const device = this.#device();
    const { port, nextHop } = decision;
    const pending: PendingSend = {
      ...(originalFrame === undefined ? {} : { originalFrame }),
      build: (destinationMac): FrameSnapshot => ({
        ethernet: { sourceMac: this.#systemMac(), destinationMac }, ipv4,
        ...(icmp === undefined ? {} : { icmp }),
        // 전달하는 패킷의 TCP·UDP와 응용 계층은 그대로 옮긴다
        ...(originalFrame === undefined ? {} : transportLayersOf(originalFrame.snapshot)),
      }),
      onSend: (context, frame, cause) => {
        const linkId = isSviName(port) ? undefined : portLink(this.#getDocument(), { deviceId: device.id, port })?.linkId;
        const params = { device: deviceRef(device), sourceIp: ipv4.sourceIp, targetIp: ipv4.destinationIp };
        context.record({
          frame, deviceId: device.id, outPort: port, ...(inPort === undefined ? {} : { inPort }),
          ...(linkId === undefined ? {} : { linkId }), ...(cause === undefined ? {} : { parentSeq: cause }),
          layer: action === "forward" ? "L3" : "ICMP", action,
          reason: action === "forward" ? { code: "IPV4_FORWARDED", params: { ...params, port, nextHop, ttl: ipv4.ttl } }
            : isIcmpError(icmp) ? { code: "ICMP_ERROR_SENT", params: { ...params, error: icmp.type } }
            : action === "create" ? { code: "ICMP_ECHO_REQUEST_SENT", params } : { code: "ICMP_ECHO_REPLY_SENT", params },
        });
      },
    };
    this.#arp(port).send(ctx, port, nextHop, pending, parentSeq);
  }

  /**
   * L3 인터페이스가 내는 프레임의 실제 전송. 라우티드 포트는 링크로 바로 나가고,
   * SVI는 그 VLAN 안에서 L2로 나간다 — MAC 표에 있으면 그 포트, 없으면 VLAN의 모든 포트
   */
  #sendL2(ctx: SimContext, iface: string, frame: Frame, parentSeq?: number): void {
    const document = this.#getDocument();
    if (!isSviName(iface)) {
      transmit(ctx, document, { deviceId: this.deviceId, port: iface }, frame, parentSeq);
      return;
    }
    const vlan = sviVlan(iface);
    if (vlan === null) return;
    const device = this.#device();
    const isUp = portUpChecker(document, device);
    const dst = frame.snapshot.ethernet.destinationMac.toLowerCase();
    const known = dst === BROADCAST_MAC ? undefined
      : this.#table.find(entry => entry.vlan === vlan && entry.mac === dst && isUp(entry.port))?.port;
    const candidates = known === undefined ? this.#l2Ports(device).filter(port => isUp(port)) : [known];
    for (const port of candidates) {
      const out = egress(device.config, port, vlan);
      if ("drop" in out) continue;
      const outFrame = out.vlanTag === undefined ? frame : ctx.updateFrame(frame, {
        ...frame.snapshot,
        ethernet: { ...frame.snapshot.ethernet, vlanTag: out.vlanTag },
      });
      transmit(ctx, document, { deviceId: this.deviceId, port }, outFrame, parentSeq);
      if (known !== undefined) return;
    }
  }

  /** 목적지가 유니캐스트로 받을 수 있는 주소인가 — 브로드캐스트·네트워크·그룹 주소는 아니다 */
  #unicast(ip: string): boolean {
    if (checkHostIpv4(ip) !== null) return false;
    return !Object.values(this.#device().config.interfaces).some(iface => iface.ip !== undefined && iface.mask !== undefined &&
      isSameNetwork(ip, iface.ip, iface.mask) && checkInterfaceAddress(ip, iface.mask) !== null);
  }

  /** ICMP 오류를 보낸 쪽으로 되돌린다. 라우터와 같은 규칙인데 터널·NAT가 없다 */
  #error(ctx: SimContext, original: Frame, type: IcmpErrorType, parentSeq: number): void {
    const { ipv4, icmp, tcp, udp, ethernet } = original.snapshot;
    const transport = tcp ?? udp;
    // ICMP 오류에 다시 오류를 만들지 않는다. 브로드캐스트·잘못된 주소에도 응답하지 않는다
    if (ipv4 === undefined || (icmp === undefined && transport === undefined) || isIcmpError(icmp) ||
      ethernet.destinationMac === BROADCAST_MAC || !this.#unicast(ipv4.sourceIp) || !this.#unicast(ipv4.destinationIp)) return;
    const sequence = icmp?.sequence ?? 0;
    const device = this.#device();
    const localInterface = Object.values(device.config.interfaces)
      .some(iface => iface.adminUp && iface.ip === ipv4.sourceIp);
    const message: IcmpMessage = { type, sequence, original: {
      sourceIp: ipv4.sourceIp, destinationIp: ipv4.destinationIp, sequence,
      ...(icmp !== undefined || transport === undefined ? {} : {
        protocol: tcp === undefined ? "udp" as const : "tcp" as const, destinationPort: transport.destinationPort,
      }),
    } };
    if (localInterface) {
      // 원래 출발지가 자신이면 로컬 전달한다
      const mac = this.#systemMac();
      const frame = ctx.createFrame({
        ethernet: { sourceMac: mac, destinationMac: mac },
        ipv4: { sourceIp: ipv4.sourceIp, destinationIp: ipv4.sourceIp, ttl: TTL }, icmp: message,
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
      sourceIp: device.config.interfaces[decision.port]?.ip ?? ipv4.sourceIp,
      destinationIp: ipv4.sourceIp, ttl: TTL,
    }, message, "reply", parentSeq);
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

  /** echo 요청을 보낸다 (`ping`, `traceroute`가 쓴다) */
  sendEcho(ctx: SimContext, targetIp: string, sequence: number, ttl = TTL): void {
    const device = this.#device();
    const decision = this.#decision(targetIp);
    if (decision === null) {
      const frame = ctx.createFrame({ ethernet: { sourceMac: this.#systemMac(), destinationMac: UNKNOWN_MAC },
        ipv4: { sourceIp: "", destinationIp: targetIp, ttl },
        icmp: { type: "echo-request", sequence } });
      ctx.record({ frame, deviceId: device.id, layer: "L3", action: "drop",
        reason: { code: "NO_ROUTE", params: { device: deviceRef(device), targetIp } } });
      return;
    }
    this.#send(ctx, decision, {
      sourceIp: device.config.interfaces[decision.port]?.ip ?? "", destinationIp: targetIp, ttl,
    }, { type: "echo-request", sequence }, "create");
  }

  /** 배운 MAC 표 (`show mac address-table`이 쓴다) */
  macTable() { return macTableView(this.#table, this.#now()); }

  arpTable() { return [...this.#arps.values()].flatMap(arp => arp.view()); }

  clearArp(ip?: string): void { for (const arp of this.#arps.values()) arp.clear(ip); }

  onConfigChanged(change: ConfigChange): void {
    const before = l3In(change.previous, this.deviceId);
    const after = l3In(change.document, this.deviceId);
    if (before === undefined || after === undefined) return;
    if (JSON.stringify(before.config.rip) !== JSON.stringify(after.config.rip)) this.#rip.clear();
    // 인터페이스·VLAN·포트가 바뀌면 ARP 모듈을 새로 만든다 — 보류 중인 전송과 표를 함께 지운다
    if (JSON.stringify(before.config.interfaces) !== JSON.stringify(after.config.interfaces) ||
      JSON.stringify(before.config.vlans) !== JSON.stringify(after.config.vlans) ||
      JSON.stringify(before.config.ports) !== JSON.stringify(after.config.ports) ||
      JSON.stringify(change.previous.links) !== JSON.stringify(change.document.links)) {
      this.#arps.clear();
    }
    // MAC 표는 스위치와 같은 규칙으로 자른다. 라우티드로 바뀐 포트의 항목도 나간다
    this.#table = pruneMacTable(this.#table, {
      config: after.config,
      isPortUp: portUpChecker(change.document, after),
      previousConfig: before.config,
    });
    this.startRun();
  }

  view(): DeviceView {
    const device = this.#device();
    const ports = portViewsOf(this.#getDocument(), device);
    const view: L3SwitchView = {
      kind: "l3switch",
      ports,
      macTable: macTableView(this.#table, this.#now()),
      arpTable: this.arpTable(),
      routingTable: this.routingTable(),
      interfaces: l3InterfaceStates(device.config, ports),
    };
    return view;
  }
}
