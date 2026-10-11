/** 입력 부품 — 이름표 달린 칸, 스위치, 갈래 고르기, 체크, 구획 */

import { useId, type ReactNode } from "react";

export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="kd-field">
      <label className="kd-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="kd-field-hint">{hint}</p>}
    </div>
  );
}

export function TextField({ label, hint, value, onChange, placeholder, type = "text", disabled }: {
  label: ReactNode; hint?: ReactNode; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; disabled?: boolean;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <input id={id} className="kd-input" type={type} value={value} placeholder={placeholder} disabled={disabled}
        onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} />
    </Field>
  );
}

export function SelectField<T extends string>({ label, hint, value, onChange, options, disabled }: {
  label: ReactNode; hint?: ReactNode; value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; disabled?: boolean;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <select id={id} className="kd-select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

export function Switch({ label, desc, checked, onChange, disabled }: {
  label: ReactNode; desc?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <label className="kd-switch">
      <span className="min-w-0">
        <span className="kd-row-title block">{label}</span>
        {desc && <span className="kd-row-desc block">{desc}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="kd-switch-track" aria-hidden="true" />
    </label>
  );
}

export function Seg<T extends string>({ value, onChange, options, label, disabled }: {
  value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; disabled?: boolean }>; label: string; disabled?: boolean;
}) {
  return (
    <div className="kd-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} disabled={disabled || o.disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Check({ label, desc, checked, onChange, disabled }: {
  label: ReactNode; desc?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <label className="kd-check" style={disabled ? { opacity: 0.5, cursor: "default" } : undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="block">{label}</span>
        {desc && <span className="kd-row-desc block">{desc}</span>}
      </span>
    </label>
  );
}

/** 공문서 항목 기호로 번호 매긴 구획 (가. 나. 다.) */
export function Section({ id, mark, title, sub, children, aside }: {
  id?: string; mark?: string; title: string; sub?: ReactNode; children: ReactNode; aside?: ReactNode;
}) {
  return (
    <section className="kd-section" id={id} aria-labelledby={id ? `${id}-t` : undefined}>
      <div className="kd-section-head">
        {mark && <span className="kd-section-mark">{mark}</span>}
        <h2 className="kd-section-title flex-1" id={id ? `${id}-t` : undefined}>{title}</h2>
        {aside}
      </div>
      {sub && <p className="kd-section-sub">{sub}</p>}
      {children}
    </section>
  );
}
