// T0.32: Hub 모델. 1계층 장비라 프레임 안을 보지 않는다 — 받은 포트를 빼고
// 케이블이 꽂힌 모든 포트로 그대로 내보낸다. VLAN도 MAC 테이블도 없어서
// 상태를 들고 있지 않고, Document만 매번 읽는다 (Switch 모델과 같은 방식).

import { BROADCAST_MAC } from "@ping9/shared";
import type { DeviceView, HubDevice, TopologyDocument } from "@ping9/shared";

import type { Frame, SimContext } from "../../kernel";
import { deviceRef, findDevice } from "../../topology";
import { portViewsOf } from "../../views";
import { transmit } from "../link";
import type { DeviceModel } from "../model";

function hubIn(document: TopologyDocument, deviceId: string): HubDevice | undefined {
  const device = findDevice(document, deviceId);
  return device?.kind === "hub" ? device : undefined;
}

const isBroadcast = (frame: Frame): boolean =>
  frame.snapshot.ethernet.destinationMac.toLowerCase() === BROADCAST_MAC;

export class HubModel implements DeviceModel {
  readonly deviceId: string;
  readonly #getDocument: () => TopologyDocument;

  constructor(deviceId: string, getDocument: () => TopologyDocument) {
    this.deviceId = deviceId;
    this.#getDocument = getDocument;
  }

  onFrame(ctx: SimContext, port: string, frame: Frame): void {
    const document = this.#getDocument();
    const device = hubIn(document, this.deviceId);
    if (device === undefined) throw new Error(`HubModel: hub ${this.deviceId} is not in the document`);
    const ref = deviceRef(device);

    const receivedSeq = ctx.record({
      frame,
      deviceId: this.deviceId,
      inPort: port,
      layer: "L2",
      action: "receive",
      reason: { code: "FRAME_RECEIVED", params: { device: ref, port } },
    });

    // 허브는 물리 계층 장비라 신호를 그냥 반복한다 — 링크가 있는 포트로만 보낸다.
    // 링크가 없는 포트로는 신호를 내도 아무 일도 없으므로 이벤트를 적지 않는다
    for (const view of portViewsOf(document, device)) {
      if (view.name === port || view.linkId === undefined) continue;
      const seq = ctx.record({
        frame,
        deviceId: this.deviceId,
        inPort: port,
        outPort: view.name,
        linkId: view.linkId,
        layer: "L2",
        action: "forward",
        reason: {
          code: "HUB_FLOODED",
          params: { device: ref, port: view.name, broadcast: isBroadcast(frame) },
        },
        parentSeq: receivedSeq,
      });
      transmit(ctx, document, { deviceId: this.deviceId, port: view.name }, frame, seq);
    }
  }

  onTimer(): void {
    // 허브는 타이머를 걸지 않는다
  }

  onConfigChanged(): void {
    // 동적 상태가 없어 지울 것도 없다
  }

  view(): DeviceView {
    const document = this.#getDocument();
    const device = hubIn(document, this.deviceId);
    if (device === undefined) throw new Error(`HubModel: hub ${this.deviceId} is not in the document`);
    return { kind: "hub", ports: portViewsOf(document, device) };
  }
}
