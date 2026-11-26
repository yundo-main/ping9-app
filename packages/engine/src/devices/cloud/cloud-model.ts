// T0.68: 인터넷 클라우드 모델. 가상의 ISP 망 — 포트 순번 i마다 `cloudPortInfo(i)`의
// /30 링크망(1.0.0.0/8을 자른 것)이 고정 배정되어, 붙은 장비 사이를 라우팅한다.
// 설정과 콘솔이 없다. 동작은 라우터의 최소판: ARP, 자기 주소 ICMP 응답, TTL을 줄인 전달.
// T0.69: 클라우드 내부는 RIP로 동작한다 — 포트마다 RIP에 참여해서 붙은 라우터가 광고한
// 네트워크를 배우고, 다른 포트로 다시 광고한다. `RipModule`(T11.2.2)을 RipHost로 재사용한다.

import { BROADCAST_MAC, cloudPortInfo, DEFAULT_DISTANCE, isIcmpError, isSameNetwork, maskToPrefixLength, PORT_NAMES, RIP_MULTICAST_MAC, checkHostIpv4, checkInterfaceAddress } from "@ping9/shared";
import type { ArpEntryView, CloudDevice, DeviceView, FrameSnapshot, IcmpErrorType, IcmpMessage, Ipv4Header, RipConfig, TopologyDocument } from "@ping9/shared";

import type { Frame, SimContext, TimerRef } from "../../kernel";
import { ArpModule } from "../../protocols/arp";
import type { PendingSend } from "../../protocols/arp";
import { transportLayersOf } from "../../protocols/transport";
import { deviceRef, findDevice, portLink, portMac } from "../../topology";
import { portViewsOf } from "../../views";
import { transmit } from "../link";
import type { DeviceModel } from "../model";
import { RipModule } from "../router/rip";
import type { RoutingEntry } from "../router/routing";

/** 클라우드가 직접 만드는 패킷(ICMP 응답·오류)의 TTL */
const CLOUD_TTL = 64;
/** 링크망 마스크 — `cloudPortInfo`와 같은 값 */
const LINK_MASK = "255.255.255.252";
/** 클라우드의 RIP 설정 — 포트의 클래스풀 네트워크 1.0.0.0 하나로 네 포트가 모두 참여한다 */
const CLOUD_RIP: RipConfig = { networks: ["1.0.0.0"], passiveInterfaces: [] };

function cloudIn(document: TopologyDocument, deviceId: string): CloudDevice | undefined {
  const device = findDevice(document, deviceId);
  return device?.kind === "cloud" ? device : undefined;
}

/** 그 IP가 어느 포트의 상대(장비) 주소인지. 포트 순번, 아니면 -1 */
const peerPortIndex = (ip: string): number =>
  PORT_NAMES.cloud.findIndex((_, index) => cloudPortInfo(index).peerIp === ip);

/** 그 IP가 어느 포트의 클라우드 주소인지. 포트 순번, 아니면 -1 */
const ownPortIndex = (ip: string): number =>
  PORT_NAMES.cloud.findIndex((_, index) => cloudPortInfo(index).cloudIp === ip);

export class CloudModel implements DeviceModel {
  readonly deviceId: string;
  readonly #getDocument: () => TopologyDocument;
  readonly #arps = new Map<string, ArpModule>();
  readonly #rip: RipModule;

  constructor(deviceId: string, getDocument: () => TopologyDocument) {
    this.deviceId = deviceId;
    this.#getDocument = getDocument;
    const device = () => cloudIn(getDocument(), this.deviceId)!;
    const linkOf = (name: string) => portLink(getDocument(), { deviceId, port: name })?.linkId;
    for (const port of PORT_NAMES.cloud) {
      this.#arps.set(port, new ArpModule({
        device: deviceRef(device()),
        ipOf: (name) => {
          const index = (PORT_NAMES.cloud as readonly string[]).indexOf(name);
          return index < 0 ? undefined : cloudPortInfo(index).cloudIp;
        },
        macOf: (name) => portMac(device(), name),
        linkOf,
        transmit: (ctx, name, frame) => { transmit(ctx, getDocument(), { deviceId, port: name }, frame); },
      }));
    }
    // RIP에 참여하는 인터페이스는 링크가 있는 포트다 — RipModule이 수신·주기 갱신·split horizon을 한다
    this.#rip = new RipModule({
      device,
      rip: () => CLOUD_RIP,
      interfaces: () => PORT_NAMES.cloud.flatMap((name, index) =>
        linkOf(name) === undefined ? [] : [{
          name, ip: cloudPortInfo(index).cloudIp, network: cloudPortInfo(index).network, mask: LINK_MASK,
        }]),
      macOf: (name) => portMac(device(), name),
      linkOf,
      send: (ctx, name, frame, parentSeq) => { transmit(ctx, getDocument(), { deviceId, port: name }, frame, parentSeq); },
    });
  }

  onFrame(ctx: SimContext, port: string, frame: Frame): void {
    const device = cloudIn(this.#getDocument(), this.deviceId);
    if (device === undefined) throw new Error(`CloudModel: cloud ${this.deviceId} is not in the document`);
    const ref = deviceRef(device);
    const mac = frame.snapshot.ethernet.destinationMac;
    if (mac !== portMac(device, port) && mac !== BROADCAST_MAC && mac !== RIP_MULTICAST_MAC) {
      ctx.record({ frame, deviceId: device.id, inPort: port, layer: "L2", action: "drop",
        reason: { code: "NOT_FOR_ME", params: { device: ref } } });
      return;
    }
    if (frame.snapshot.arp !== undefined) { this.#arps.get(port)?.onArp(ctx, port, frame); return; }
    if (frame.snapshot.rip !== undefined) { this.#rip.onFrame(ctx, port, frame); return; }
    this.#receiveIp(ctx, port, frame);
  }

  #receiveIp(ctx: SimContext, port: string, frame: Frame): void {
    const device = cloudIn(this.#getDocument(), this.deviceId)!;
    const ref = deviceRef(device);
    const { ipv4, icmp } = frame.snapshot;
    if (ipv4 === undefined) return;
    if (!this.#unicast(ipv4.destinationIp)) {
      ctx.record({ frame, deviceId: device.id, inPort: port, layer: "L3", action: "drop",
        reason: { code: "NOT_FOR_ME", params: { device: ref } } });
      return;
    }
    const received = ctx.record({ frame, deviceId: device.id, inPort: port, layer: "L3", action: "receive",
      reason: { code: "IPV4_RECEIVED", params: { device: ref, sourceIp: ipv4.sourceIp, targetIp: ipv4.destinationIp } } });

    // 자기 주소 — 어느 포트의 클라우드 IP든 로컬 도착이다
    if (ownPortIndex(ipv4.destinationIp) >= 0) {
      if (icmp?.type === "echo-request") {
        const request = ctx.record({ frame, deviceId: device.id, inPort: port, layer: "ICMP", action: "receive", parentSeq: received,
          reason: { code: "ICMP_ECHO_REQUEST_RECEIVED", params: { device: ref, sourceIp: ipv4.sourceIp, targetIp: ipv4.destinationIp } } });
        this.#send(ctx, port, ipv4.sourceIp, {
          sourceIp: ipv4.destinationIp, destinationIp: ipv4.sourceIp, ttl: CLOUD_TTL,
        }, { type: "echo-reply", sequence: icmp.sequence }, "reply", request);
      } else if (isIcmpError(icmp)) {
        if (icmp.original.sourceIp !== ipv4.destinationIp || icmp.original.sequence !== icmp.sequence) return;
        ctx.record({ frame, deviceId: device.id, inPort: port, layer: "ICMP", action: "receive", parentSeq: received,
          reason: { code: "ICMP_ERROR_RECEIVED", params: { device: ref, sourceIp: ipv4.sourceIp, targetIp: ipv4.destinationIp, error: icmp.type } } });
      } else if (icmp?.type === "echo-reply") {
        ctx.record({ frame, deviceId: device.id, inPort: port, layer: "ICMP", action: "receive", parentSeq: received,
          reason: { code: "ICMP_ECHO_REPLY_RECEIVED", params: { device: ref, sourceIp: ipv4.sourceIp, targetIp: ipv4.destinationIp } } });
      } else if (icmp === undefined) {
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

    // 전달 — 목적지가 어느 포트의 상대 주소거나 RIP로 배운 네트워크 안이다
    const route = this.#lookup(ipv4.destinationIp);
    if (ipv4.ttl <= 1 || route === undefined || route.port === port) {
      const droppedFrame = ipv4.ttl <= 1 ? ctx.updateFrame(frame, { ...frame.snapshot, ipv4: { ...ipv4, ttl: 0 } }) : frame;
      const dropped = ctx.record({ frame: droppedFrame, deviceId: device.id, inPort: port, layer: "L3", action: "drop", parentSeq: received,
        reason: ipv4.ttl <= 1 ? { code: "TTL_EXPIRED", params: { device: ref } }
          : { code: "NO_ROUTE", params: { device: ref, targetIp: ipv4.destinationIp } } });
      this.#error(ctx, frame, ipv4.ttl <= 1 ? "time-exceeded" : "destination-unreachable", dropped);
      return;
    }
    this.#send(ctx, route.port, route.nextHop, { ...ipv4, ttl: ipv4.ttl - 1 }, icmp, "forward", received, frame, port);
  }

  /** 나갈 포트와 다음 홉 — /30 상대 주소는 직결이고, 그 외는 RIP로 배운 경로의 longest-prefix다 */
  #lookup(ip: string): { readonly port: string; readonly nextHop: string } | undefined {
    const direct = peerPortIndex(ip);
    if (direct >= 0) return { port: PORT_NAMES.cloud[direct]!, nextHop: cloudPortInfo(direct).peerIp };
    let best: RoutingEntry | undefined;
    let bestLength = -1;
    for (const route of this.#rip.routes()) {
      const length = maskToPrefixLength(route.mask);
      if (length === null || !isSameNetwork(ip, route.network, route.mask)) continue;
      if (length > bestLength) { best = route; bestLength = length; }
    }
    return best?.nextHop === undefined ? undefined : { port: best.port, nextHop: best.nextHop };
  }

  /** 다음 홉으로 보낸다 — 링크망 직결이라 다음 홉은 목적지 자신 (router의 #send와 같은 형태의 축소판) */
  #send(ctx: SimContext, outPort: string, nextHop: string, ipv4: Ipv4Header, icmp: IcmpMessage | undefined,
    action: "forward" | "reply", parentSeq?: number, originalFrame?: Frame, inPort?: string): void {
    const device = cloudIn(this.#getDocument(), this.deviceId)!;
    const pending: PendingSend = {
      ...(originalFrame === undefined ? {} : { originalFrame }),
      build: (destinationMac): FrameSnapshot => ({
        ethernet: { sourceMac: portMac(device, outPort), destinationMac }, ipv4,
        ...(icmp === undefined ? {} : { icmp }),
        ...(originalFrame === undefined ? {} : transportLayersOf(originalFrame.snapshot)),
      }),
      onSend: (context, frame, cause) => {
        const linkId = portLink(this.#getDocument(), { deviceId: device.id, port: outPort })?.linkId;
        const params = { device: deviceRef(device), sourceIp: ipv4.sourceIp, targetIp: ipv4.destinationIp };
        context.record({ frame, deviceId: device.id, outPort, ...(inPort === undefined ? {} : { inPort }),
          ...(linkId === undefined ? {} : { linkId }), ...(cause === undefined ? {} : { parentSeq: cause }),
          layer: action === "forward" ? "L3" : "ICMP", action,
          reason: action === "forward" ? { code: "IPV4_FORWARDED", params: { ...params, port: outPort, nextHop, ttl: ipv4.ttl } }
            : isIcmpError(icmp) ? { code: "ICMP_ERROR_SENT", params: { ...params, error: icmp.type } }
            : { code: "ICMP_ECHO_REPLY_SENT", params } });
      },
    };
    this.#arps.get(outPort)!.send(ctx, outPort, nextHop, pending, parentSeq);
  }

  /** ICMP 오류를 보낸 쪽으로 돌린다 — 라우팅 테이블이 닿는 주소에만 온다 (router의 #error 축소판) */
  #error(ctx: SimContext, original: Frame, type: IcmpErrorType, parentSeq: number): void {
    const { ipv4, icmp, tcp, udp, ethernet } = original.snapshot;
    const transport = tcp ?? udp;
    if (ipv4 === undefined || (icmp === undefined && transport === undefined) || isIcmpError(icmp) ||
      ethernet.destinationMac === BROADCAST_MAC || !this.#unicast(ipv4.sourceIp) || !this.#unicast(ipv4.destinationIp)) return;
    const route = this.#lookup(ipv4.sourceIp);
    if (route === undefined) return;
    const message: IcmpMessage = { type, sequence: icmp?.sequence ?? 0, original: {
      sourceIp: ipv4.sourceIp, destinationIp: ipv4.destinationIp, sequence: icmp?.sequence ?? 0,
      ...(icmp !== undefined || transport === undefined ? {} : {
        protocol: tcp === undefined ? "udp" as const : "tcp" as const, destinationPort: transport.destinationPort,
      }),
    } };
    this.#send(ctx, route.port, route.nextHop, {
      sourceIp: ipv4.destinationIp, destinationIp: ipv4.sourceIp, ttl: CLOUD_TTL,
    }, message, "reply", parentSeq);
  }

  /** 유니캐스트인가 — 링크망의 네트워크·브로드캐스트 주소는 아니다 */
  #unicast(ip: string): boolean {
    if (checkHostIpv4(ip) !== null) return false;
    const length = maskToPrefixLength(LINK_MASK);
    return length !== null && !PORT_NAMES.cloud.some((_, index) => {
      const { cloudIp } = cloudPortInfo(index);
      return isSameNetwork(ip, cloudIp, LINK_MASK) && checkInterfaceAddress(ip, LINK_MASK) !== null;
    });
  }

  onTimer(ctx: SimContext, timer: TimerRef): void {
    for (const arp of this.#arps.values()) arp.onTimer(ctx, timer);
    this.#rip.onTimer(ctx, timer);
  }

  /** 회차가 시작될 때 런타임이 부른다 — 남은 ARP 대기열만 비우면 된다. 배운 경로는 라우터처럼 유지한다 */
  startRun(): void {
    for (const arp of this.#arps.values()) arp.discardPending();
  }

  /** 경로 교환의 시작 (T0.69). RIP Router가 있어 교환이 돌 때 런타임이 함께 부른다 */
  startRipExchange(ctx: SimContext): void {
    this.#rip.startExchange(ctx);
  }

  onConfigChanged(): void {
    // 클라우드의 설정은 고정이라 배운 것을 지울 이유가 링크 변화뿐이다 — 안전하게 전부 지운다
    for (const arp of this.#arps.values()) arp.clear();
    this.#rip.clear();
  }

  arpTable(): readonly ArpEntryView[] { return [...this.#arps.values()].flatMap(arp => arp.view()); }

  /** 연결된 /30 링크망 + RIP로 배운 경로. 인스펙터의 라우팅 표와 경로 변화 diff가 쓴다 */
  routingTable(): readonly RoutingEntry[] {
    return [
      ...PORT_NAMES.cloud.map((port, index): RoutingEntry => ({
        source: "connected", network: cloudPortInfo(index).network, mask: LINK_MASK, port,
        distance: DEFAULT_DISTANCE.connected, metric: 0,
      })),
      ...this.#rip.routes(),
    ];
  }

  view(): DeviceView {
    const document = this.#getDocument();
    const device = cloudIn(document, this.deviceId);
    if (device === undefined) throw new Error(`CloudModel: cloud ${this.deviceId} is not in the document`);
    return { kind: "cloud", ports: portViewsOf(document, device), arpTable: this.arpTable(), routes: this.routingTable() };
  }
}
