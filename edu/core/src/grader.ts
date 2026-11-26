// 채점기 (dev-plan E2). 레슨의 Check를 순서대로 평가한다 —
// `ping`은 채점기가 직접 콘솔에 ping을 쳐서 성공을 확인한다 (학생이 친 흔적이 아니라
// 지금 설정이 통하는지를 본다). `trace`는 학생의 행동이 추적에 남겼는지를 본다 —
// ping 채점이 만든 추적과 구분하려면 레슨에서 trace 체크를 ping보다 앞에 둔다.

import type { Simulator } from "@ping9/engine";
import { checkHostIpv4, cloudPortInfo, portIndex, PORT_NAMES } from "@ping9/shared";
import type { Device, DeviceView, TopologyDocument } from "@ping9/shared";
import type { Check, Lesson } from "./lesson";

export interface CheckResult {
  readonly check: Check;
  readonly ok: boolean;
  /** 실패 이유 또는 확인된 값 — 학생 피드백에 그대로 쓴다 */
  readonly detail: string;
}

export interface GradeResult {
  /** 모든 체크를 통과했으면 true */
  readonly ok: boolean;
  readonly results: readonly CheckResult[];
}

export async function grade(simulator: Simulator, lesson: Lesson): Promise<GradeResult> {
  const results: CheckResult[] = [];
  for (const check of lesson.checks) results.push(await runCheck(simulator, check));
  return { ok: results.every((result) => result.ok), results };
}

function deviceByName(document: TopologyDocument, name: string): Device | undefined {
  return document.devices.find((device) => device.name === name);
}

async function runCheck(simulator: Simulator, check: Check): Promise<CheckResult> {
  const document = simulator.getSnapshot().document;
  switch (check.kind) {
    case "ip": return checkIp(document, check);
    case "link": return checkLink(document, check);
    case "route": return checkRoute(simulator, check);
    case "trace": return checkTrace(simulator, check);
    case "ping": return await checkPing(simulator, check);
  }
}

/** 장비의 한 포트에 설정된 주소 (pc/server는 config.ip, router/l3switch는 interfaces, cloud는 고정 /30) */
function addressOf(device: Device, port: string): { readonly ip: string; readonly mask: string } | undefined {
  const config = device.config as {
    readonly ip?: string; readonly mask?: string;
    readonly interfaces?: Readonly<Record<string, { readonly ip?: string; readonly mask?: string }>>;
  };
  if (device.kind === "cloud") {
    const index = portIndex("cloud", port);
    return index < 0 ? undefined : { ip: cloudPortInfo(index).cloudIp, mask: "255.255.255.252" };
  }
  if (device.kind === "pc" || device.kind === "server" || device.kind === "lb") {
    return config.ip === undefined || config.mask === undefined
      ? undefined : { ip: config.ip, mask: config.mask };
  }
  return config.interfaces?.[port]?.ip !== undefined && config.interfaces[port]?.mask !== undefined
    ? { ip: config.interfaces[port]!.ip!, mask: config.interfaces[port]!.mask! }
    : undefined;
}

function checkIp(document: TopologyDocument, check: Extract<Check, { kind: "ip" }>): CheckResult {
  const device = deviceByName(document, check.device);
  if (device === undefined) return { check, ok: false, detail: `${check.device} 장비가 없어요` };
  if (!isPortName(device.kind, check.port)) return { check, ok: false, detail: `${check.device}에 ${check.port} 포트가 없어요` };
  const address = addressOf(device, check.port);
  if (address === undefined) return { check, ok: false, detail: `${check.device} ${check.port}에 주소가 없어요` };
  const ok = address.ip === check.ip && address.mask === check.mask;
  return { check, ok, detail: ok ? `${check.ip}/${check.mask} 확인` : `지금은 ${address.ip}/${address.mask}예요` };
}

function isPortName(kind: Device["kind"], port: string): boolean {
  return (PORT_NAMES[kind] as readonly string[]).includes(port);
}

function checkLink(document: TopologyDocument, check: Extract<Check, { kind: "link" }>): CheckResult {
  const a = deviceByName(document, check.a.device);
  const b = deviceByName(document, check.b.device);
  if (a === undefined || b === undefined) {
    return { check, ok: false, detail: `${a === undefined ? check.a.device : check.b.device} 장비가 없어요` };
  }
  const ok = document.links.some((link) =>
    link.ends.some((end) => end.deviceId === a.id && end.port === check.a.port) &&
    link.ends.some((end) => end.deviceId === b.id && end.port === check.b.port));
  return { check, ok, detail: ok ? "링크 연결됨" : `${check.a.device} ${check.a.port} ↔ ${check.b.device} ${check.b.port} 링크가 없어요` };
}

function routesOf(view: DeviceView | undefined): readonly { readonly network: string }[] {
  return view !== undefined && "routes" in view ? view.routes : [];
}

function checkRoute(simulator: Simulator, check: Extract<Check, { kind: "route" }>): CheckResult {
  const document = simulator.getSnapshot().document;
  const device = deviceByName(document, check.device);
  if (device === undefined) return { check, ok: false, detail: `${check.device} 장비가 없어요` };
  const ok = routesOf(simulator.getSnapshot().views[device.id])
    .some((route) => route.network === check.network);
  return { check, ok, detail: ok ? `${check.network} 경로 있음` : `${check.network} 경로가 라우팅 표에 없어요` };
}

function checkTrace(simulator: Simulator, check: Extract<Check, { kind: "trace" }>): CheckResult {
  for (const summary of simulator.getSnapshot().traces) {
    const trace = simulator.getTrace(summary.id);
    if (trace?.events.some((event) => event.reason?.code === check.code)) {
      return { check, ok: true, detail: `${check.code} 이벤트 확인` };
    }
  }
  return { check, ok: false, detail: `추적에 ${check.code}가 없어요 — ping을 한번 쳐 보세요` };
}

/** ping의 목적지 — IP 문자열이거나 장비 이름(그 장비의 첫 주소) */
function targetOf(document: TopologyDocument, to: string): string | undefined {
  if (checkHostIpv4(to) === null) return to;
  const device = deviceByName(document, to);
  if (device === undefined) return undefined;
  const config = device.config as { readonly ip?: string; readonly interfaces?: Readonly<Record<string, { readonly ip?: string }>> };
  return device.kind === "cloud"
    ? cloudPortInfo(0).cloudIp
    : config.ip ?? Object.values(config.interfaces ?? {}).find((iface) => iface.ip !== undefined)?.ip;
}

/** ping 성공 줄 — PC는 `bytes=32`, 라우터는 `Reply from ... TTL=` */
function isSuccessLine(text: string): boolean {
  return text.includes("bytes=32") || (text.startsWith("Reply from") && text.includes("TTL="));
}

async function checkPing(simulator: Simulator, check: Extract<Check, { kind: "ping" }>): Promise<CheckResult> {
  const document = simulator.getSnapshot().document;
  const device = deviceByName(document, check.from);
  if (device === undefined) return { check, ok: false, detail: `${check.from} 장비가 없어요` };
  const target = targetOf(document, check.to);
  if (target === undefined) return { check, ok: false, detail: `${check.to}의 주소를 못 찾았어요` };
  const result = await simulator.console(device.id).exec(`ping ${target}`);
  const ok = result.lines.some((line) => line.kind === "text" && isSuccessLine(line.text));
  return { check, ok, detail: ok ? `${target}에 ping 성공` : `${target}에 ping이 닿지 않아요` };
}
