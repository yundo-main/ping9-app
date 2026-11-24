// LB의 프런트엔드 편집 (T0.34). listenPort 하나당 백엔드 목록을 두고,
// 고칠 때마다 목록 통째로 `lb/set-frontends`를 dispatch한다 (AD-3).
import { LIMITS } from "@ping9/shared";
import type { Command, DispatchResult, LbDevice, LbFrontend } from "@ping9/shared";

function setFrontends(deviceId: string, frontends: readonly LbFrontend[]): Command {
  return { type: "lb/set-frontends", deviceId, frontends };
}

export function LbSettings({ device, onDispatch }: {
  readonly device: LbDevice;
  readonly onDispatch: (command: Command) => DispatchResult;
}) {
  const frontends = device.config.frontends;
  const change = (index: number, next: LbFrontend) =>
    onDispatch(setFrontends(device.id, frontends.map((frontend, i) => i === index ? next : frontend)));
  const remove = (index: number) =>
    onDispatch(setFrontends(device.id, frontends.filter((_, i) => i !== index)));

  return (
    <>
      <h4>프런트엔드</h4>
      {frontends.length === 0 && <div className="sub">아직 받는 포트가 없어요</div>}
      {frontends.map((frontend, index) => (
        <div key={frontend.listenPort} className="lb-frontend">
          <div className="if-row">
            <span className="ip">:{frontend.listenPort}</span>
            <select aria-label={`:${frontend.listenPort} 모드`} value={frontend.mode}
              onChange={(event) => change(index, {
                ...frontend,
                mode: event.target.value === "http" ? "http" : "tcp",
                // tcp로 돌리면 경로 접두는 의미가 없다
                backends: event.target.value === "http" ? frontend.backends
                  : frontend.backends.map(backend => ({ ip: backend.ip, port: backend.port, weight: backend.weight })),
              })}>
              <option value="tcp">L4 TCP</option>
              <option value="http">L7 HTTP</option>
            </select>
            <button type="button" className="dns-remove" aria-label={`:${frontend.listenPort} 삭제`}
              onClick={() => remove(index)}>×</button>
          </div>
          {frontend.backends.map((backend, bIndex) => (
            <div key={`${backend.ip}:${backend.port}`} className="if-row lb-backend">
              {backend.ip}:{backend.port}
              <span className="port-state">
                weight {backend.weight}{frontend.mode === "http" && backend.pathPrefix !== undefined ? ` · ${backend.pathPrefix}` : ""}
              </span>
              <button type="button" className="dns-remove" aria-label={`${backend.ip}:${backend.port} 백엔드 삭제`}
                onClick={() => change(index, { ...frontend, backends: frontend.backends.filter((_, i) => i !== bIndex) })}>×</button>
            </div>
          ))}
          <form className="pc-form dns-form" onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const ip = (form.elements.namedItem("ip") as HTMLInputElement).value.trim();
            const port = Number((form.elements.namedItem("port") as HTMLInputElement).value);
            const weight = Number((form.elements.namedItem("weight") as HTMLInputElement).value) || 1;
            const path = frontend.mode === "http" ? (form.elements.namedItem("path") as HTMLInputElement).value.trim() : "";
            change(index, { ...frontend, backends: [...frontend.backends,
              { ip, port, weight, ...(path === "" ? {} : { pathPrefix: path }) }] });
            form.reset();
          }}>
            <input name="ip" type="text" inputMode="decimal" autoComplete="off" spellCheck={false}
              maxLength={15} placeholder="10.0.1.10" required />
            <input name="port" type="number" min={1} max={65535} placeholder="80" required />
            <input name="weight" type="number" min={1} max={100} defaultValue={1} />
            {frontend.mode === "http" && <input name="path" type="text" autoComplete="off" spellCheck={false}
              maxLength={64} placeholder="경로 /api (선택)" />}
            <button type="submit" className="dns-add">백엔드 추가</button>
          </form>
        </div>
      ))}
      {frontends.length < LIMITS.maxLbFrontends &&
        <form className="pc-form dns-form" onSubmit={(event) => {
          event.preventDefault();
          const input = event.currentTarget.elements.namedItem("listen") as HTMLInputElement;
          const listenPort = Number(input.value);
          if (listenPort >= 1 && listenPort <= 65535 && !frontends.some(f => f.listenPort === listenPort)) {
            onDispatch(setFrontends(device.id, [...frontends, { listenPort, mode: "tcp", backends: [] }]));
            input.value = "";
          }
        }}>
          <input name="listen" type="number" min={1} max={65535} placeholder="받을 포트 (80)" required />
          <button type="submit" className="dns-add">프런트엔드 추가</button>
        </form>}
      <div className="sub">
        L4 TCP는 DNAT 전달 · L7 HTTP는 프록시(경로 접두로 백엔드를 고름) · 백엔드의 게이트웨이는 이 LB여야 해요
      </div>
    </>
  );
}
