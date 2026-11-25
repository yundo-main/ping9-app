// reducer: 서버로 쓰는 PC의 서비스 (T0.20). `pc/set-service`, `pc/add-dns-record`, `pc/remove-dns-record`.
// 속성 패널의 서비스 구역과 서버 콘솔의 `systemctl`이 같은 Command를 낸다 (AD-3).
// 종류가 Server인 PC에만 쓴다. 다른 종류로 바꿔도 서비스 구성은 문서에 남아, 다시 Server로 고르면 그대로다.

import {
  LIMITS,
  SERVICE_KINDS,
  checkHostIpv4,
  checkHostName,
  dnsRecordsOf,
  errorInfo,
  isServerDevice,
  isServer,
  normalizeServices,
  servicesOf,
  validateDocument,
} from "@ping9/shared";
import type { ErrorInfo, ServerConfig, ServerDevice, ServiceKind, TopologyDocument } from "@ping9/shared";

import { describeValue } from "../describe";
import type { CommandHandler, ReduceResult } from "../reducer";

const fail = (error: ErrorInfo): ReduceResult => ({ ok: false, error });

function findServer(document: TopologyDocument, deviceId: unknown):
  | { readonly ok: true; readonly device: ServerDevice }
  | { readonly ok: false; readonly error: ErrorInfo } {
  const device = document.devices.find((candidate) => candidate.id === deviceId);
  if (device === undefined) return { ok: false, error: errorInfo("DEVICE_NOT_FOUND", { deviceId: describeValue(deviceId) }) };
  if (!isServerDevice(device)) {
    return { ok: false, error: errorInfo("DEVICE_KIND_MISMATCH", { deviceId: device.id, expected: "server", actual: device.kind }) };
  }
  if (!isServer(device.config)) return { ok: false, error: errorInfo("PC_NOT_SERVER", { deviceId: device.id }) };
  return { ok: true, device };
}

function withConfig(document: TopologyDocument, device: ServerDevice, config: ServerConfig): ReduceResult {
  const checked = validateDocument({
    ...document,
    devices: document.devices.map((candidate) => (candidate.id === device.id ? { ...device, config } : candidate)),
  });
  return checked.ok ? { ok: true, document: checked.document, notices: [] } : checked;
}

const checkAccount = (value: unknown): value is { user: string; password: string } =>
  typeof value === "object" && value !== null &&
  typeof (value as Record<string, unknown>)["user"] === "string" &&
  typeof (value as Record<string, unknown>)["password"] === "string" &&
  (value as { user: string }).user.length > 0;

/** SSH 접속 계정 목록을 통째로 바꾼다 (T0.56). 계정 형태는 스키마가 보고 여기서는 한 번 더 본다 */
export const setServerSshAccounts: CommandHandler<"server/set-ssh-accounts"> = (document, command) => {
  const found = findServer(document, command.deviceId);
  if (!found.ok) return found;
  const { device } = found;
  if (!Array.isArray(command.accounts) || !command.accounts.every(checkAccount)) {
    return fail(errorInfo("DOCUMENT_INVALID_SHAPE", { path: "accounts" }));
  }
  return withConfig(document, device, { ...device.config, sshAccounts: command.accounts });
};

const checkFile = (value: unknown): value is { name: string; content: string } =>
  typeof value === "object" && value !== null &&
  typeof (value as Record<string, unknown>)["name"] === "string" &&
  typeof (value as Record<string, unknown>)["content"] === "string";

/** HTTP·FTP가 내놓는 파일 목록을 통째로 바꾼다 (T0.58). 같은 이름을 지우려면 목록에서 빼면 된다 */
export const setServerFiles: CommandHandler<"server/set-files"> = (document, command) => {
  const found = findServer(document, command.deviceId);
  if (!found.ok) return found;
  const { device } = found;
  if (!Array.isArray(command.files) || !command.files.every(checkFile)) {
    return fail(errorInfo("DOCUMENT_INVALID_SHAPE", { path: "files" }));
  }
  return withConfig(document, device, { ...device.config, files: command.files });
};

/** NTP 서비스가 답하는 계층 (T0.58). stratum 1~15 */
export const setServerNtp: CommandHandler<"server/set-ntp"> = (document, command) => {
  const found = findServer(document, command.deviceId);
  if (!found.ok) return found;
  const { device } = found;
  if (typeof command.stratum !== "number") return fail(errorInfo("DOCUMENT_INVALID_SHAPE", { path: "stratum" }));
  return withConfig(document, device, { ...device.config, ntpStratum: command.stratum });
};

export const setServerService: CommandHandler<"server/set-service"> = (document, command) => {
  const found = findServer(document, command.deviceId);
  if (!found.ok) return found;
  const { device } = found;
  if (typeof command.service !== "string" || !(SERVICE_KINDS as readonly string[]).includes(command.service)) {
    return fail(errorInfo("DOCUMENT_INVALID_SHAPE", { path: "service" }));
  }
  if (typeof command.enabled !== "boolean") return fail(errorInfo("DOCUMENT_INVALID_SHAPE", { path: "enabled" }));
  const enabled = servicesOf(device.config);
  if (enabled.includes(command.service) === command.enabled) return { ok: true, document, notices: [] };
  const next: readonly ServiceKind[] = command.enabled
    ? [...enabled, command.service]
    : enabled.filter((kind) => kind !== command.service);
  return withConfig(document, device, { ...device.config, services: normalizeServices(next) });
};

export const addServerDnsRecord: CommandHandler<"server/add-dns-record"> = (document, command) => {
  const found = findServer(document, command.deviceId);
  if (!found.ok) return found;
  const { device } = found;
  if (typeof command.name !== "string") return fail(errorInfo("DNS_NAME_INVALID", { value: describeValue(command.name) }));
  if (typeof command.address !== "string" || command.address.length > 64) {
    return fail(errorInfo("INVALID_IPV4", { value: describeValue(command.address) }));
  }
  // 이름은 대소문자를 가리지 않는다. 소문자로 맞춰 저장한다
  const name = command.name.toLowerCase();
  const error = checkHostName(name) ?? checkHostIpv4(command.address);
  if (error !== null) return fail(error);

  const records = dnsRecordsOf(device.config);
  const record = { name, address: command.address };
  if (records.some((candidate) => candidate.name === name)) {
    return withConfig(document, device, {
      ...device.config, dnsRecords: records.map((candidate) => (candidate.name === name ? record : candidate)),
    });
  }
  if (records.length >= LIMITS.maxDnsRecords) {
    return fail(errorInfo("LIMIT_EXCEEDED", { limit: "dnsRecords", max: LIMITS.maxDnsRecords }));
  }
  return withConfig(document, device, { ...device.config, dnsRecords: [...records, record] });
};

export const removeServerDnsRecord: CommandHandler<"server/remove-dns-record"> = (document, command) => {
  const found = findServer(document, command.deviceId);
  if (!found.ok) return found;
  const { device } = found;
  const name = typeof command.name === "string" ? command.name.toLowerCase() : undefined;
  const records = dnsRecordsOf(device.config);
  if (name === undefined || !records.some((candidate) => candidate.name === name)) {
    return fail(errorInfo("DNS_RECORD_NOT_FOUND", { deviceId: device.id, name: describeValue(command.name) }));
  }
  return withConfig(document, device, { ...device.config, dnsRecords: records.filter((candidate) => candidate.name !== name) });
};
