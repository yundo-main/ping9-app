// LB 모델 (T0.34). 리눅스 기반 L4 로드밸런서 — HAProxy의 `mode tcp`.
// 자기 IP의 listenPort로 오는 TCP SYN은 가중 라운드로빈으로 백엔드를 골라 목적지를 재작성한다(DNAT).
// 백엔드의 응답은 출발지를 VIP로 되돌려 보낸다 — 클라이언트는 VIP 하나하고만 통신한 것으로 본다.
// 그 외의 패킷은 작은 라우터다: TTL-1로 전달하고, 자기 IP로 온 ICMP에는 답한다.
// RIP·터널·NAT 규칙은 없다. 구성은 매번 Document에서 읽고, 동적 상태(ARP·바인딩·RR 카운터)만 든다.

import { BROADCAST_MAC, PORT_NAMES, UNKNOWN_MAC, checkHostIpv4, checkInterfaceAddress, isIcmpError, isSameNetwork } from "@ping9/shared";
import type { ApplicationData, DeviceView, EventCode, FrameSnapshot, IcmpErrorType, IcmpMessage, Ipv4Header, LbBindingView, LbDevice, Reason, TcpFlags, TopologyDocument } from "@ping9/shared";

import type { Frame, SimContext, TimerRef } from "../../kernel";
import { deviceRef, findDevice, isAdminUp, portLink, portMac } from "../../topology";
import { portViewsOf } from "../../views";
import { transmit } from "../link";
import type { ConfigChange, DeviceModel } from "../model";
import { ArpModule } from "../../protocols/arp";
import type { PendingSend } from "../../protocols/arp";
import { transportLayersOf } from "../../protocols/transport";
import { lookupRoute, routingTable } from "../router/routing";
import type { RouteDecision } from "../router/routing";

const TTL = 255;

/** 연결 하나의 대응. 요청은 client→backend로, 응답은 backend→vip로 재작성한다 */
interface LbBinding {
  readonly clientIp: string;
  readonly clientPort: number;
  /** 클라이언트가 연결한 주소 — 응답의 출발지가 된다 */
  readonly vipIp: string;
  readonly vipPort: number;
  readonly backendIp: string;
  readonly backendPort: number;
}

/** L7 프록시 연결 하나. 클라이언트 다리가 먼저 맺히고, 요청이 오면 백엔드 다리를 연다 (T0.35) */
interface L7Conn {
  readonly clientIp: string;
  readonly clientPort: number;
  readonly vipIp: string;
  readonly vipPort: number;
  /** 클라이언트가 보낸 요청 첫 줄 — 백엔드에 그대로 전달한다 */
  message?: string;
  /** 요청이 경로 규칙으로 고른 백엔드. 보내기 전에는 없다 */
  backendIp?: string;
  backendPort?: number;
  /** 백엔드 다리에서 LB가 쓰는 출발 포트 */
  lbPort?: number;
}

function lbIn(document: TopologyDocument, deviceId: string): LbDevice | undefined {
  const device = findDevice(document, deviceId);
  return device?.kind === "lb" ? device : undefined;
}

export class LbModel implements DeviceModel {
  readonly deviceId: string;
  readonly #getDocument: () => TopologyDocument;
  readonly #arps = new Map<string, ArpModule>();
  /** 클라이언트 키(`ip:port`)로 찾는 바인딩 정본 */
  readonly #byClient = new Map<string, LbBinding>();
  /** 백엔드 키(`backendIp:backendPort:clientIp:clientPort`)로 찾는 역방향 색인 */
  readonly #byBackend = new Map<string, LbBinding>();
  /** 프런트엔드(listenPort)별 가중 라운드로빈 커서 */
  readonly #cursors = new Map<number, number>();
  /** L7: 클라이언트 키(`cip:cport:vport`)로 찾는 연결 */
  readonly #l7ByClient = new Map<string, L7Conn>();
  /** L7: 백엔드 다리 키(`bip:bport:lbPort`)로 찾는 연결 */
  readonly #l7ByBackend = new Map<string, L7Conn>();
  /** L7 백엔드 다리의 출발 포트 번호와 경로 풀별 라운드로빈 커서 */
  #l7NextPort = 41000;
  readonly #l7Cursors = new Map<string, number>();
  readonly #replies = new Set<number>();

  constructor(deviceId: string, getDocument: () => TopologyDocument) {
    this.deviceId = deviceId;
    this.#getDocument = getDocument;
  }

  #device(): LbDevice {
    const device = lbIn(this.#getDocument(), this.deviceId);
    if (device === undefined) throw new Error(`LbModel: lb ${this.deviceId} is not in the document`);
    return device;
  }

  #arp(port: string): ArpModule {
    let module = this.#arps.get(port);
    if (module === undefined) {
      const getDocument = this.#getDocument;
      const deviceId = this.deviceId;
      const current = () => this.#device();
      module = new ArpModule({
        get device() { return deviceRef(current()); },
        ipOf: () => current().config.interfaces[port]?.ip,
        macOf: () => portMac(current(), port),
        linkOf: () => portLink(getDocument(), { deviceId, port })?.linkId,
        transmit: (ctx, _port, frame) => transmit(ctx, getDocument(), { deviceId, port }, frame),
      });
      this.#arps.set(port, module);
    }
    return module;
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
    if (mac !== portMac(device, port) && mac !== BROADCAST_MAC) {
      drop({ code: "NOT_FOR_ME", params: { device: ref } });
      return;
    }
    if (frame.snapshot.arp !== undefined) { this.#arp(port).onArp(ctx, port, frame); return; }
    this.#receiveIp(ctx, port, frame);
  }

  #receiveIp(ctx: SimContext, port: string, frame: Frame): void {
    const device = this.#device();
    const ref = deviceRef(device);
    const { ipv4, icmp, tcp } = frame.snapshot;
    if (ipv4 === undefined) return;
    if (!this.#unicast(ipv4.destinationIp)) {
      ctx.record({ frame, deviceId: device.id, inPort: port, layer: "L3", action: "drop",
        reason: { code: "NOT_FOR_ME", params: { device: ref } } });
      return;
    }
    const received = ctx.record({
      frame, deviceId: device.id, inPort: port, layer: "L3", action: "receive",
      reason: { code: "IPV4_RECEIVED", params: { device: ref, sourceIp: ipv4.sourceIp, targetIp: ipv4.destinationIp } },
    });

    // 백엔드의 응답인가 — 바인딩이 있으면 출발지를 VIP로 되돌린다
    if (tcp !== undefined) {
      const binding = this.#byBackend.get(`${ipv4.sourceIp}:${tcp.sourcePort}:${ipv4.destinationIp}:${tcp.destinationPort}`);
      if (binding !== undefined) {
        const rewritten = ctx.updateFrame(frame, {
          ...frame.snapshot,
          ipv4: { ...ipv4, sourceIp: binding.vipIp, ttl: ipv4.ttl - 1 },
          tcp: { ...tcp, sourcePort: binding.vipPort },
        });
        this.#forward(ctx, rewritten, binding.clientIp, received, port);
        return;
      }
    }

    const ownIp = Object.entries(device.config.interfaces)
      .find(([, iface]) => iface.adminUp && iface.ip === ipv4.destinationIp);
    if (ownIp !== undefined) {
      if (icmp?.type === "echo-request") {
        const request = ctx.record({ frame, deviceId: device.id, inPort: port, layer: "ICMP", action: "receive", parentSeq: received,
          reason: { code: "ICMP_ECHO_REQUEST_RECEIVED", params: { device: ref, sourceIp: ipv4.sourceIp, targetIp: ipv4.destinationIp } } });
        const decision = this.#decision(ipv4.sourceIp);
        if (decision !== null) this.#send(ctx, decision, {
          sourceIp: ipv4.destinationIp, destinationIp: ipv4.sourceIp, ttl: TTL,
        }, { type: "echo-reply", sequence: icmp.sequence }, "reply", request);
      } else if (isIcmpError(icmp)) {
        if (icmp.original.sourceIp !== ipv4.destinationIp || icmp.original.sequence !== icmp.sequence) return;
        ctx.record({ frame, deviceId: device.id, inPort: port, layer: "ICMP", action: "receive", parentSeq: received,
          reason: { code: "ICMP_ERROR_RECEIVED", params: { device: ref, sourceIp: ipv4.sourceIp, targetIp: ipv4.destinationIp, error: icmp.type } } });
      } else if (icmp?.type === "echo-reply") {
        ctx.record({ frame, deviceId: device.id, inPort: port, layer: "ICMP", action: "receive", parentSeq: received,
          reason: { code: "ICMP_ECHO_REPLY_RECEIVED", params: { device: ref, sourceIp: ipv4.sourceIp, targetIp: ipv4.destinationIp } } });
        this.#replies.add(icmp.sequence);
      } else if (icmp === undefined && tcp !== undefined) {
        if (this.#handleTcp(ctx, port, frame, ipv4, tcp.destinationPort, received)) return;
        const closed = ctx.record({ frame, deviceId: device.id, inPort: port, parentSeq: received,
          layer: "TCP", action: "drop",
          reason: { code: "PORT_CLOSED", params: { device: ref, protocol: "tcp", port: tcp.destinationPort } } });
        this.#error(ctx, frame, "destination-unreachable", closed);
      }
      return;
    }

    // 나머지는 통과 패킷 — TTL-1로 전달한다
    if (ipv4.ttl <= 1) {
      const droppedFrame = ctx.updateFrame(frame, { ...frame.snapshot, ipv4: { ...ipv4, ttl: 0 } });
      const dropped = ctx.record({ frame: droppedFrame, deviceId: device.id, inPort: port, layer: "L3", action: "drop", parentSeq: received,
        reason: { code: "TTL_EXPIRED", params: { device: ref } } });
      this.#error(ctx, frame, "time-exceeded", dropped);
      return;
    }
    this.#forward(ctx, frame, ipv4.destinationIp, received, port);
  }

  /**
   * 내 주소로 온 TCP를 나눈다. L7 백엔드 다리의 응답, http 프런트엔드의 클라이언트 다리,
   * 그리고 tcp 프런트엔드의 DNAT. 어느 것도 맞지 않으면 false → PORT_CLOSED
   */
  #handleTcp(ctx: SimContext, port: string, frame: Frame, ipv4: Ipv4Header, listenPort: number, parentSeq: number): boolean {
    const tcp = frame.snapshot.tcp!;
    const leg = this.#l7ByBackend.get(`${ipv4.sourceIp}:${tcp.sourcePort}:${tcp.destinationPort}`);
    if (leg !== undefined) return this.#backendLeg(ctx, port, frame, ipv4, leg, parentSeq);
    const frontend = this.#device().config.frontends.find(candidate => candidate.listenPort === listenPort);
    if (frontend?.mode === "http") return this.#clientLeg(ctx, port, frame, ipv4, frontend.listenPort, parentSeq);
    return this.#accept(ctx, port, frame, ipv4, listenPort, parentSeq);
  }

  /**
   * L7 프록시의 클라이언트 다리 (T0.35). SYN에는 SYN-ACK으로 직접 답하고, 요청이 오면
   * 경로 접두로 백엔드 풀을 좁혀 가중 라운드로빈으로 골라 백엔드 다리를 연다
   */
  #clientLeg(ctx: SimContext, port: string, frame: Frame, ipv4: Ipv4Header, vipPort: number, parentSeq: number): boolean {
    const device = this.#device();
    const ref = deviceRef(device);
    const tcp = frame.snapshot.tcp!;
    const application = frame.snapshot.application;
    const clientKey = `${ipv4.sourceIp}:${tcp.sourcePort}:${vipPort}`;
    const received = ctx.record({
      frame, deviceId: device.id, inPort: port, parentSeq, layer: application === undefined ? "TCP" : "APP",
      action: "receive",
      reason: application === undefined
        ? { code: "TCP_SEGMENT_RECEIVED", params: { device: ref, sourceIp: ipv4.sourceIp, targetIp: ipv4.destinationIp, port: vipPort, flags: tcp.flags } }
        : { code: "SERVICE_REQUEST_RECEIVED", params: { device: ref, service: application.service, sourceIp: ipv4.sourceIp, targetIp: ipv4.destinationIp, port: vipPort, message: application.message } },
    });

    if (tcp.flags === "SYN") {
      this.#l7ByClient.set(clientKey, { clientIp: ipv4.sourceIp, clientPort: tcp.sourcePort, vipIp: ipv4.destinationIp, vipPort });
      this.#sendSegment(ctx, ipv4.destinationIp, ipv4.sourceIp,
        { tcp: { sourcePort: vipPort, destinationPort: tcp.sourcePort, flags: "SYN-ACK" } },
        "TCP", "reply", { code: "TCP_SEGMENT_SENT", params: { device: ref, sourceIp: ipv4.destinationIp, targetIp: ipv4.sourceIp, port: vipPort, flags: "SYN-ACK" } }, received);
      return true;
    }
    const conn = this.#l7ByClient.get(clientKey);
    if (conn === undefined) return false;
    if (tcp.flags === "ACK" || tcp.flags === "SYN-ACK") return true;
    if (tcp.flags === "RST") { this.#l7ByClient.delete(clientKey); return true; }
    if (application === undefined || conn.backendIp !== undefined) return true;

    // 요청 왔다 — 경로 접두로 후보 풀을 좁히고 가중 라운드로빈으로 고른다
    const frontend = device.config.frontends.find(candidate => candidate.listenPort === vipPort);
    if (frontend === undefined) return true;
    const path = application.message.split(/\s+/)[1] ?? "/";
    const tagged = frontend.backends.filter(backend => backend.pathPrefix !== undefined && path.startsWith(backend.pathPrefix));
    const pool = tagged.length > 0 ? tagged : frontend.backends.filter(backend => backend.pathPrefix === undefined);
    if (pool.length === 0) {
      // 맞는 백엔드가 없다 — HAProxy처럼 503으로 답한다
      this.#sendSegment(ctx, conn.vipIp, conn.clientIp,
        { tcp: { sourcePort: vipPort, destinationPort: conn.clientPort, flags: "PSH-ACK" },
          application: { service: application.service, message: "503 Service Unavailable" } },
        "APP", "reply", { code: "SERVICE_RESPONSE_SENT", params: {
          device: ref, service: application.service, sourceIp: conn.vipIp, targetIp: conn.clientIp, port: vipPort,
          message: "503 Service Unavailable" } }, received);
      return true;
    }
    const expanded = pool.flatMap((backend, index) => Array<number>(backend.weight).fill(index));
    const cursorKey = `${vipPort}|${tagged[0]?.pathPrefix ?? ""}`;
    const cursor = this.#l7Cursors.get(cursorKey) ?? 0;
    const backend = pool[expanded[cursor % expanded.length]!]!;
    this.#l7Cursors.set(cursorKey, cursor + 1);

    const lbPort = this.#l7NextPort++;
    const routed: L7Conn = { ...conn, message: application.message, backendIp: backend.ip, backendPort: backend.port, lbPort };
    this.#l7ByClient.set(clientKey, routed);
    this.#l7ByBackend.set(`${backend.ip}:${backend.port}:${lbPort}`, routed);
    ctx.record({
      frame, deviceId: device.id, inPort: port, parentSeq: received, layer: "APP", action: "forward",
      reason: { code: "L7_REQUEST_ROUTED", params: {
        device: ref, client: `${conn.clientIp}:${conn.clientPort}`,
        backend: `${backend.ip}:${backend.port}`, path } },
    });
    // 백엔드 다리를 연다 — 백엔드는 LB의 나가는 인터페이스 IP를 출발지로 본다
    const decision = this.#decision(backend.ip);
    const srcIp = decision === null ? undefined : device.config.interfaces[decision.port]?.ip;
    if (decision === null || srcIp === undefined) return true;
    this.#sendSegment(ctx, srcIp, backend.ip,
      { tcp: { sourcePort: lbPort, destinationPort: backend.port, flags: "SYN" } },
      "TCP", "create", { code: "TCP_SEGMENT_SENT", params: { device: ref, sourceIp: srcIp, targetIp: backend.ip, port: backend.port, flags: "SYN" } }, received);
    return true;
  }

  /**
   * L7 백엔드 다리의 응답. SYN-ACK에는 ACK와 요청을 이어 보내고,
   * 응답은 클라이언트에게 VIP 주소로 되돌려 보낸다
   */
  #backendLeg(ctx: SimContext, port: string, frame: Frame, ipv4: Ipv4Header, conn: L7Conn, parentSeq: number): boolean {
    const device = this.#device();
    const ref = deviceRef(device);
    const tcp = frame.snapshot.tcp!;
    const application = frame.snapshot.application;
    const srcIp = ipv4.destinationIp;
    const received = ctx.record({
      frame, deviceId: device.id, inPort: port, parentSeq, layer: application === undefined ? "TCP" : "APP",
      action: "receive",
      reason: application === undefined
        ? { code: "TCP_SEGMENT_RECEIVED", params: { device: ref, sourceIp: ipv4.sourceIp, targetIp: srcIp, port: tcp.destinationPort, flags: tcp.flags } }
        : { code: "SERVICE_RESPONSE_RECEIVED", params: { device: ref, service: application.service, sourceIp: ipv4.sourceIp, targetIp: srcIp, port: tcp.destinationPort, message: application.message } },
    });

    if (tcp.flags === "SYN-ACK") {
      const layers = (flags: TcpFlags) => ({ tcp: { sourcePort: tcp.destinationPort, destinationPort: tcp.sourcePort, flags } });
      this.#sendSegment(ctx, srcIp, ipv4.sourceIp, layers("ACK"), "TCP", "create",
        { code: "TCP_SEGMENT_SENT", params: { device: ref, sourceIp: srcIp, targetIp: ipv4.sourceIp, port: tcp.sourcePort, flags: "ACK" } }, received);
      if (conn.message !== undefined) {
        this.#sendSegment(ctx, srcIp, ipv4.sourceIp,
          { ...layers("PSH-ACK"), application: { service: "http", message: conn.message } },
          "APP", "create", { code: "SERVICE_REQUEST_SENT", params: {
            device: ref, service: "http", sourceIp: srcIp, targetIp: ipv4.sourceIp, port: tcp.sourcePort,
            message: conn.message } }, received);
      }
      return true;
    }
    if (tcp.flags === "ACK") return true;
    if (application === undefined) return true;
    // 백엔드의 응답 — 클라이언트에게 VIP 주소로 되돌린다
    this.#sendSegment(ctx, conn.vipIp, conn.clientIp,
      { tcp: { sourcePort: conn.vipPort, destinationPort: conn.clientPort, flags: "PSH-ACK" }, application },
      "APP", "reply", { code: "SERVICE_RESPONSE_SENT", params: {
        device: ref, service: application.service, sourceIp: conn.vipIp, targetIp: conn.clientIp, port: conn.vipPort,
        message: application.message } }, received);
    return true;
  }

  /**
   * 새 TCP 연결을 프런트엔드에 맞춘다. SYN이면 가중 라운드로빈으로 백엔드를 골라 바인딩을 만들고
   * 목적지를 재작성해 전달한다. 맞는 프런트엔드가 없으면 false를 돌려 PORT_CLOSED로 간다
   */
  #accept(ctx: SimContext, port: string, frame: Frame, ipv4: Ipv4Header, listenPort: number, parentSeq: number): boolean {
    const device = this.#device();
    const frontend = device.config.frontends.find(candidate => candidate.listenPort === listenPort);
    const clientKey = `${ipv4.sourceIp}:${frame.snapshot.tcp!.sourcePort}`;
    let binding = this.#byClient.get(clientKey);
    // 바인딩이 있으면 같은 연결의 뒤 세그먼트(ACK, 요청)도 백엔드로 간다
    if (binding === undefined) {
      if (frontend === undefined || frontend.mode !== "tcp" || tcpFlagsOf(frame) !== "SYN") return false;
      if (frontend.backends.length === 0) return false;
      // 가중 라운드로빈: weight만큼 벌인 목록을 순서대로 돈다
      const expanded = frontend.backends.flatMap((backend, index) => Array<number>(backend.weight).fill(index));
      const cursor = this.#cursors.get(listenPort) ?? 0;
      const backend = frontend.backends[expanded[cursor % expanded.length]!]!;
      this.#cursors.set(listenPort, cursor + 1);
      binding = {
        clientIp: ipv4.sourceIp, clientPort: frame.snapshot.tcp!.sourcePort,
        vipIp: ipv4.destinationIp, vipPort: listenPort,
        backendIp: backend.ip, backendPort: backend.port,
      };
      this.#byClient.set(clientKey, binding);
      this.#byBackend.set(`${binding.backendIp}:${binding.backendPort}:${binding.clientIp}:${binding.clientPort}`, binding);
      ctx.record({
        frame, deviceId: device.id, inPort: port, layer: "TCP", action: "forward", parentSeq,
        reason: { code: "LB_BACKEND_SELECTED", params: {
          device: deviceRef(device),
          client: `${binding.clientIp}:${binding.clientPort}`,
          backend: `${binding.backendIp}:${binding.backendPort}`,
        } },
      });
    }
    const tcp = frame.snapshot.tcp!;
    const rewritten = ctx.updateFrame(frame, {
      ...frame.snapshot,
      ipv4: { ...ipv4, destinationIp: binding.backendIp, ttl: ipv4.ttl - 1 },
      tcp: { ...tcp, destinationPort: binding.backendPort },
    });
    this.#forward(ctx, rewritten, binding.backendIp, parentSeq, port);
    return true;
  }

  /** 목적지를 정해 나간다 — 결정이 없으면 NO_ROUTE로 버린다 */
  #forward(ctx: SimContext, frame: Frame, destination: string, parentSeq: number, inPort?: string): void {
    const device = this.#device();
    const decision = this.#decision(destination);
    const { ipv4 } = frame.snapshot;
    if (decision === null || ipv4 === undefined) {
      ctx.record({ frame, deviceId: device.id, inPort, layer: "L3", action: "drop", parentSeq,
        reason: { code: "NO_ROUTE", params: { device: deviceRef(device), targetIp: destination } } });
      return;
    }
    this.#send(ctx, decision, ipv4, frame.snapshot.icmp, "forward", parentSeq, frame, inPort);
  }

  #decision(destination: string): RouteDecision | null {
    const device = this.#device();
    const ports = portViewsOf(this.#getDocument(), device);
    return lookupRoute(routingTable(device.config, ports), destination);
  }

  /** `show ip route`용 라우팅 테이블 */
  routingTable(): ReturnType<typeof routingTable> {
    const device = this.#device();
    return routingTable(device.config, portViewsOf(this.#getDocument(), device));
  }

  /**
   * L7 프록시가 직접 만드는 세그먼트를 보낸다. 경로를 조회해 다음 홉으로 ARP한다.
   * 경로가 없으면 조용히 놓는다 — 연결은 응답 없이 타임아웃으로 끝난다
   */
  #sendSegment(
    ctx: SimContext, sourceIp: string, targetIp: string,
    layers: { readonly tcp?: { readonly sourcePort: number; readonly destinationPort: number; readonly flags: TcpFlags };
      readonly application?: ApplicationData },
    layer: "TCP" | "APP", action: "create" | "reply", reason: Reason<EventCode>, parentSeq?: number,
  ): void {
    const decision = this.#decision(targetIp);
    const device = this.#device();
    if (decision === null) return;
    const { port, nextHop } = decision;
    const ipv4: Ipv4Header = { sourceIp, destinationIp: targetIp, ttl: TTL };
    const pending: PendingSend = {
      build: (destinationMac): FrameSnapshot => ({
        ethernet: { sourceMac: portMac(device, port), destinationMac }, ipv4, ...layers,
      }),
      onSend: (context, frame, cause) => {
        const linkId = portLink(this.#getDocument(), { deviceId: device.id, port })?.linkId;
        context.record({
          frame, deviceId: device.id, outPort: port, ...(linkId === undefined ? {} : { linkId }),
          ...(cause === undefined ? {} : { parentSeq: cause }), layer, action, reason,
        });
      },
    };
    this.#arp(port).send(ctx, port, nextHop, pending, parentSeq);
  }

  /** 나가는 패킷을 다음 홉의 MAC으로 싸서 보낸다 */
  #send(ctx: SimContext, decision: RouteDecision, ipv4: Ipv4Header, icmp: IcmpMessage | undefined,
    action: "forward" | "reply" | "create", parentSeq?: number, originalFrame?: Frame, inPort?: string): void {
    const device = this.#device();
    const { port, nextHop } = decision;
    const pending: PendingSend = {
      ...(originalFrame === undefined ? {} : { originalFrame }),
      build: (destinationMac): FrameSnapshot => ({
        ethernet: { sourceMac: portMac(device, port), destinationMac }, ipv4,
        ...(icmp === undefined ? {} : { icmp }),
        ...(originalFrame === undefined ? {} : transportLayersOf(originalFrame.snapshot)),
      }),
      onSend: (context, frame, cause) => {
        const linkId = portLink(this.#getDocument(), { deviceId: device.id, port })?.linkId;
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

  /** 목적지가 유니캐스트로 받을 수 있는 주소인가 */
  #unicast(ip: string): boolean {
    if (checkHostIpv4(ip) !== null) return false;
    return !Object.values(this.#device().config.interfaces).some(iface => iface.ip !== undefined && iface.mask !== undefined &&
      isSameNetwork(ip, iface.ip, iface.mask) && checkInterfaceAddress(ip, iface.mask) !== null);
  }

  /** ICMP 오류를 보낸 쪽으로 되돌린다 */
  #error(ctx: SimContext, original: Frame, type: IcmpErrorType, parentSeq: number): void {
    const { ipv4, icmp, tcp, udp, ethernet } = original.snapshot;
    const transport = tcp ?? udp;
    if (ipv4 === undefined || (icmp === undefined && transport === undefined) || isIcmpError(icmp) ||
      ethernet.destinationMac === BROADCAST_MAC || !this.#unicast(ipv4.sourceIp) || !this.#unicast(ipv4.destinationIp)) return;
    const sequence = icmp?.sequence ?? 0;
    const device = this.#device();
    const message: IcmpMessage = { type, sequence, original: {
      sourceIp: ipv4.sourceIp, destinationIp: ipv4.destinationIp, sequence,
      ...(icmp !== undefined || transport === undefined ? {} : {
        protocol: tcp === undefined ? "udp" as const : "tcp" as const, destinationPort: transport.destinationPort,
      }),
    } };
    const decision = this.#decision(ipv4.sourceIp);
    if (decision === null) return;
    this.#send(ctx, decision, {
      sourceIp: device.config.interfaces[decision.port]?.ip ?? ipv4.sourceIp,
      destinationIp: ipv4.sourceIp, ttl: TTL,
    }, message, "reply", parentSeq);
  }

  onTimer(ctx: SimContext, timer: TimerRef): void {
    for (const arp of this.#arps.values()) arp.onTimer(ctx, timer);
  }

  startRun(): void {
    for (const arp of this.#arps.values()) arp.discardPending();
    this.#byClient.clear();
    this.#byBackend.clear();
    this.#cursors.clear();
    this.#l7ByClient.clear();
    this.#l7ByBackend.clear();
    this.#l7Cursors.clear();
    this.#replies.clear();
  }

  repliesReceived(): readonly number[] { return [...this.#replies]; }

  /** ping이 쓴다 — 경로가 있어야 나간다 */
  sendEcho(ctx: SimContext, targetIp: string, sequence: number, ttl = TTL): void {
    const device = this.#device();
    const decision = this.#decision(targetIp);
    if (decision === null) {
      const frame = ctx.createFrame({ ethernet: { sourceMac: portMac(device, PORT_NAMES.lb[0]), destinationMac: UNKNOWN_MAC },
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

  arpTable() { return [...this.#arps.values()].flatMap(arp => arp.view()); }

  clearArp(ip?: string): void { for (const arp of this.#arps.values()) arp.clear(ip); }

  onConfigChanged(change: ConfigChange): void {
    const before = lbIn(change.previous, this.deviceId);
    const after = lbIn(change.document, this.deviceId);
    if (before === undefined || after === undefined) return;
    // 인터페이스·링크·프런트엔드가 바뀌면 ARP와 바인딩을 새로 시작한다
    if (JSON.stringify(before.config.interfaces) !== JSON.stringify(after.config.interfaces) ||
      JSON.stringify(before.config.frontends) !== JSON.stringify(after.config.frontends) ||
      JSON.stringify(change.previous.links) !== JSON.stringify(change.document.links)) {
      this.#arps.clear();
      this.#byClient.clear();
      this.#byBackend.clear();
      this.#cursors.clear();
      this.#l7ByClient.clear();
      this.#l7ByBackend.clear();
      this.#l7Cursors.clear();
    }
    this.startRun();
  }

  view(): DeviceView {
    const device = this.#device();
    const ports = portViewsOf(this.#getDocument(), device);
    const interfaces = Object.entries(device.config.interfaces).map(([name, iface]) => ({
      name, ip: iface.ip, mask: iface.mask,
      status: !iface.adminUp ? "admin-down" as const
        : ports.find(view => view.name === name)?.status === "up" ? "up" as const : "down" as const,
    }));
    return {
      kind: "lb", ports, interfaces,
      bindings: [
        ...[...this.#byClient.values()].map((binding): LbBindingView => ({
          clientIp: binding.clientIp, clientPort: binding.clientPort, vipPort: binding.vipPort,
          backendIp: binding.backendIp, backendPort: binding.backendPort,
        })),
        ...[...this.#l7ByClient.values()].flatMap((conn): LbBindingView[] =>
          conn.backendIp === undefined || conn.backendPort === undefined ? [] : [{
            clientIp: conn.clientIp, clientPort: conn.clientPort, vipPort: conn.vipPort,
            backendIp: conn.backendIp, backendPort: conn.backendPort,
          }]),
      ],
    };
  }
}

function tcpFlagsOf(frame: Frame): string | undefined {
  return frame.snapshot.tcp?.flags;
}
