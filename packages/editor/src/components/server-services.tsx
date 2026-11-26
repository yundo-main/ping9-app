// 속성 패널에서 서버로 쓰는 PC에만 있는 구역 (T0.20): 서비스 켜고 끄기와 DNS 이름.
// 스위치는 누르는 즉시 server/set-service를, DNS 이름은 "추가"·"삭제"로 server/add-dns-record·server/remove-dns-record를 dispatch한다 (AD-3).
// 모양은 포트 스위치(T0.14)와 IP 설정(T1.5.2)의 것을 그대로 쓴다. 문구는 카탈로그에서 만든다 (AD-14).

import { MAX_HOST_NAME_LENGTH, SERVICE_KINDS, SERVICE_PORTS, dnsRecordsOf, serverFilesOf, servicesOf, sshAccountsOf } from "@ping9/shared";
import type { Command, DispatchResult, ErrorInfo, ServerDevice, ServiceKind } from "@ping9/shared";
import { useId, useState } from "react";

import { formatError } from "../messages/errors";

export const SERVICE_LABELS: Readonly<Record<ServiceKind, string>> = { http: "HTTP", https: "HTTPS", dns: "DNS", ntp: "NTP", ftp: "FTP", ssh: "SSH" };

/** 서비스 스위치를 켰을 때 보여줄 설정 구역의 id 꼬리 (T0.59) */
const SERVICE_SECTION: Partial<Readonly<Record<ServiceKind, string>>> = {
  http: "files", https: "files", ftp: "files", dns: "dns", ntp: "ntp", ssh: "ssh",
};

/** 스위치를 눌렀을 때 낼 Command */
export function serviceCommand(deviceId: string, service: ServiceKind, enabled: boolean): Command {
  return { type: "server/set-service", deviceId, service, enabled };
}

/** 서비스 하나의 스위치. 색만으로 구별하지 않도록 "켜짐"·"꺼짐" 글자를 함께 쓴다 */
function ServiceSwitch({ service, enabled, onChange }: {
  readonly service: ServiceKind;
  readonly enabled: boolean;
  readonly onChange: (enabled: boolean) => void;
}) {
  const { protocol, port } = SERVICE_PORTS[service];
  return (
    <div className={enabled ? "port-row" : "port-row off"}>
      <span className="port-name">{SERVICE_LABELS[service]}</span>
      <span className="key">{protocol}/{port}</span>
      <button
        type="button"
        className="port-switch"
        role="switch"
        aria-checked={enabled}
        aria-label={`${SERVICE_LABELS[service]} 서비스`}
        onClick={() => onChange(!enabled)}
      >
        <span className="state">{enabled ? "켜짐" : "꺼짐"}</span>
        <span className="track" aria-hidden="true">
          <span className="knob" />
        </span>
      </button>
    </div>
  );
}

export function ServerServices({ device, onDispatch }: {
  readonly device: ServerDevice;
  readonly onDispatch: (command: Command) => DispatchResult;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [sshUser, setSshUser] = useState("");
  const [sshPassword, setSshPassword] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const files = serverFilesOf(device.config, device.name);
  const stratum = device.config.ntpStratum ?? 1;
  const enabled = servicesOf(device.config);
  const records = dnsRecordsOf(device.config);
  const accounts = sshAccountsOf(device.config);

  const add = () => {
    const result = onDispatch({ type: "server/add-dns-record", deviceId: device.id, name: name.trim(), address: address.trim() });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setName("");
    setAddress("");
  };

  const setAccounts = (accounts: { user: string; password: string }[]) =>
    onDispatch({ type: "server/set-ssh-accounts", deviceId: device.id, accounts });

  const addAccount = () => {
    const user = sshUser.trim();
    if (user === "") return;
    const result = setAccounts([...accounts.filter((account) => account.user !== user), { user, password: sshPassword }]);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setSshUser("");
    setSshPassword("");
  };

  return (
    <>
      <h4>서비스</h4>
      {SERVICE_KINDS.map((service) => (
        <ServiceSwitch key={service} service={service} enabled={enabled.includes(service)}
          onChange={(next) => {
            onDispatch(serviceCommand(device.id, service, next));
            const section = next ? SERVICE_SECTION[service] : undefined;
            if (section !== undefined) {
              document.getElementById(`${id}-section-${section}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
              setFlash(section);
              window.setTimeout(() => setFlash(null), 1600);
            }
          }} />
      ))}

      <h4 id={`${id}-section-dns`} className={flash === "dns" ? "flash" : undefined}>DNS 이름</h4>
      {records.length === 0 && <div className="sub">아직 넣은 이름이 없어요</div>}
      {records.map((record) => (
        <div key={record.name} className="if-row">
          {record.name}
          <span className="ip">{record.address}</span>
          <button type="button" className="dns-remove" aria-label={`${record.name} 삭제`}
            onClick={() => onDispatch({ type: "server/remove-dns-record", deviceId: device.id, name: record.name })}>
            ×
          </button>
        </div>
      ))}
      <form className="pc-form dns-form" onSubmit={(event) => { event.preventDefault(); add(); }}>
        <div className="field">
          <label htmlFor={`${id}-name`}>이름</label>
          <input id={`${id}-name`} type="text" autoComplete="off" spellCheck={false} maxLength={MAX_HOST_NAME_LENGTH}
            placeholder="www.ping9.test" value={name}
            onChange={(event) => { setName(event.target.value); setError(null); }} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-address`}>주소</label>
          <input id={`${id}-address`} type="text" inputMode="decimal" autoComplete="off" spellCheck={false} maxLength={15}
            placeholder="10.0.2.10" value={address}
            onChange={(event) => { setAddress(event.target.value); setError(null); }} />
        </div>
        {error !== null && <div className="form-err" role="alert">{formatError(error)}</div>}
        <button type="submit" className="apply">추가</button>
      </form>

      <h4 id={`${id}-section-files`} className={flash === "files" ? "flash" : undefined}>파일</h4>
      <div className="sub">HTTP·FTP로 내놓는 파일이에요</div>
      {files.map((file) => (
        <div key={file.name} className="if-row">
          {file.name}
          <span className="ip">{file.content.length}자</span>
          <button type="button" className="dns-remove" aria-label={`${file.name} 삭제`}
            onClick={() => onDispatch({ type: "server/set-files", deviceId: device.id, files: files.filter((candidate) => candidate.name !== file.name) })}>
            ×
          </button>
        </div>
      ))}
      <form className="pc-form dns-form" onSubmit={(event) => {
        event.preventDefault();
        const trimmed = fileName.trim();
        if (trimmed === "") return;
        const result = onDispatch({
          type: "server/set-files", deviceId: device.id,
          files: [...files.filter((file) => file.name !== trimmed), { name: trimmed, content: fileContent }],
        });
        if (!result.ok) { setError(result.error); return; }
        setError(null);
        setFileName("");
        setFileContent("");
      }}>
        <div className="field">
          <label htmlFor={`${id}-file-name`}>이름</label>
          <input id={`${id}-file-name`} type="text" autoComplete="off" spellCheck={false} maxLength={64}
            placeholder="index.html" value={fileName}
            onChange={(event) => { setFileName(event.target.value); setError(null); }} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-file-content`}>내용</label>
          <textarea id={`${id}-file-content`} rows={3} spellCheck={false} maxLength={4096}
            placeholder="<html>…</html>" value={fileContent}
            onChange={(event) => { setFileContent(event.target.value); setError(null); }} />
        </div>
        <button type="submit" className="apply">추가·덮어쓰기</button>
      </form>

      <h4 id={`${id}-section-ntp`} className={flash === "ntp" ? "flash" : undefined}>NTP</h4>
      <form className="pc-form dns-form" onSubmit={(event) => {
        event.preventDefault();
        const result = onDispatch({ type: "server/set-ntp", deviceId: device.id, stratum });
        if (!result.ok) setError(result.error); else setError(null);
      }}>
        <div className="field">
          <label htmlFor={`${id}-stratum`}>계층 (stratum)</label>
          <input id={`${id}-stratum`} type="number" min={1} max={15} value={stratum}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isInteger(value) && value >= 1 && value <= 15) {
                onDispatch({ type: "server/set-ntp", deviceId: device.id, stratum: value });
              }
            }} />
        </div>
        <button type="submit" className="apply" hidden aria-hidden="true">적용</button>
      </form>

      <h4 id={`${id}-section-ssh`} className={flash === "ssh" ? "flash" : undefined}>SSH 계정</h4>
      <div className="sub">ssh &lt;사용자&gt;@&lt;이 서버의 IP&gt;로 접속합니다</div>
      {accounts.map((account) => (
        <div key={account.user} className="if-row">
          {account.user}
          <span className="ip">{"•".repeat(Math.min(8, Math.max(4, account.password.length)))}</span>
          <button type="button" className="dns-remove" aria-label={`${account.user} 계정 삭제`}
            onClick={() => setAccounts(accounts.filter((candidate) => candidate.user !== account.user))}>
            ×
          </button>
        </div>
      ))}
      <form className="pc-form dns-form" onSubmit={(event) => { event.preventDefault(); addAccount(); }}>
        <div className="field">
          <label htmlFor={`${id}-ssh-user`}>사용자</label>
          <input id={`${id}-ssh-user`} type="text" autoComplete="off" spellCheck={false} maxLength={32}
            placeholder="admin" value={sshUser}
            onChange={(event) => { setSshUser(event.target.value); setError(null); }} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-ssh-pass`}>비밀번호</label>
          <input id={`${id}-ssh-pass`} type="password" autoComplete="off" maxLength={64}
            placeholder="ping9" value={sshPassword}
            onChange={(event) => { setSshPassword(event.target.value); setError(null); }} />
        </div>
        <button type="submit" className="apply">추가</button>
      </form>
    </>
  );
}
