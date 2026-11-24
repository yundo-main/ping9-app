// reducer: `interface/set-admin` (T3.3.2, FR-18). 포트를 끄고 켠다.
// Switch의 포트와 Router의 인터페이스(T4.1.1), PC의 포트(T0.14)를 다룬다.

import { errorInfo, isPortName, isTunnelName } from "@ping9/shared";

import { describeValue } from "../describe";
import type { CommandHandler } from "../reducer";
import { findL3Switch, l3SetAdmin } from "./l3switch";
import { checkSwitchPort, findSwitch, withSwitchPort } from "./switch-common";
import { updateTunnel } from "./router-tunnel";

export const setInterfaceAdmin: CommandHandler<"interface/set-admin"> = (document, command) => {
  const pc = document.devices.find(device => device.id === command.deviceId);
  if (pc !== undefined && (pc.kind === "pc" || pc.kind === "server")) {
    if (typeof command.port !== "string" || !isPortName(pc.kind, command.port)) {
      return { ok: false, error: errorInfo("UNKNOWN_PORT", {
        deviceId: pc.id, kind: pc.kind, port: describeValue(command.port),
      }) };
    }
    if (typeof command.adminUp !== "boolean") {
      return { ok: false, error: errorInfo("DOCUMENT_INVALID_SHAPE", { path: "adminUp" }) };
    }
    // 켜도 칸을 지우지 않고 true로 둔다. IP와 게이트웨이는 그대로다 (T0.14 결정 4)
    return {
      ok: true,
      document: {
        ...document,
        devices: document.devices.map(device => device !== pc ? device
          : pc.kind === "pc"
            ? { ...pc, config: { ...pc.config, adminUp: command.adminUp } }
            : { ...pc, config: { ...pc.config, adminUp: command.adminUp } }),
      },
      notices: [],
    };
  }
  const router = document.devices.find(device => device.id === command.deviceId);
  if (router?.kind === "router") {
    if (typeof command.port === "string" && isTunnelName(command.port) && typeof command.adminUp === "boolean") {
      return updateTunnel(document, router, command.port, { adminUp: command.adminUp });
    }
    if (typeof command.port !== "string" || !isPortName("router", command.port)) {
      return { ok: false, error: errorInfo("UNKNOWN_PORT", {
        deviceId: router.id, kind: "router", port: describeValue(command.port),
      }) };
    }
    if (typeof command.adminUp !== "boolean") {
      return { ok: false, error: errorInfo("DOCUMENT_INVALID_SHAPE", { path: "adminUp" }) };
    }
    return {
      ok: true,
      document: { ...document, devices: document.devices.map(device => device !== router ? device : {
        ...router, config: { ...router.config,
          ...(router.config.vyos === undefined ? {} : { vyos: undefined }),
          interfaces: { ...router.config.interfaces,
            [command.port]: { ...router.config.interfaces[command.port], adminUp: command.adminUp },
          },
        },
      }) },
      notices: [],
    };
  }
  const l3 = findL3Switch(document, command.deviceId);
  if (l3.ok) return l3SetAdmin(document, l3.device, command);
  const found = findSwitch(document, command.deviceId);
  if (!found.ok) return found;

  const portError = checkSwitchPort(found.device, command.port);
  if (portError !== null) return { ok: false, error: portError };

  // 경계 밖에서 온 값일 수 있다. 참거짓이 아니면 받아들이지 않는다 (AD-16)
  if (typeof command.adminUp !== "boolean") {
    return { ok: false, error: errorInfo("DOCUMENT_INVALID_SHAPE", { path: "adminUp" }) };
  }

  return {
    ok: true,
    document: withSwitchPort(document, found.device, command.port, { adminUp: command.adminUp }),
    notices: [],
  };
};
