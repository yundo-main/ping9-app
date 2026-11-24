// reducer: `server/set-os` (T0.25). Server를 PC로 되돌린다.
// `windows`/`linux`를 고르면 kind가 `pc`인 장비로 바뀐다. 반대 방향은 `pc/set-os`가 한다.
// IP 구성과 링크는 그대로 둔다. 서비스·DNS·필터 구성도 config에 남아, 다시 Server로 올리면 그대로다.

import { errorInfo } from "@ping9/shared";

import { describeValue } from "../describe";
import type { CommandHandler } from "../reducer";

const PC_OSES = ["windows", "linux"] as const;

function isPcOs(value: unknown): value is (typeof PC_OSES)[number] {
  return typeof value === "string" && (PC_OSES as readonly string[]).includes(value);
}

export const setServerOs: CommandHandler<"server/set-os"> = (document, command) => {
  const device = document.devices.find((candidate) => candidate.id === command.deviceId);
  if (device === undefined) {
    return { ok: false, error: errorInfo("DEVICE_NOT_FOUND", { deviceId: describeValue(command.deviceId) }) };
  }
  if (device.kind !== "server") {
    return {
      ok: false,
      error: errorInfo("DEVICE_KIND_MISMATCH", { deviceId: device.id, expected: "server", actual: device.kind }),
    };
  }

  // 경계 밖에서 온 값일 수 있다. 정해진 OS가 아니면 받아들이지 않는다 (AD-16)
  if (!isPcOs(command.os)) {
    return { ok: false, error: errorInfo("DOCUMENT_INVALID_SHAPE", { path: "os" }) };
  }

  const os = command.os;
  return {
    ok: true,
    document: {
      ...document,
      devices: document.devices.map((candidate) =>
        candidate.id === device.id ? { ...device, kind: "pc" as const, config: { ...device.config, os } } : candidate,
      ),
    },
    notices: [],
  };
};
