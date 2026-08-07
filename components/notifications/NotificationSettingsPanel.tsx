"use client";

import { useState } from "react";
import { updateNotificationSettingsAction } from "@/lib/notifications/notificationSettingsActions";
import {
  NOTIFICATION_GROUPS,
  NOTIFICATION_GROUP_LABELS,
  type NotificationSettings,
} from "@/lib/notifications/notificationSettingsModel";

type Toggle = { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean };

function ToggleRow(props: { title: string; note: string; toggle: Toggle }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div>
        <p className="text-sm font-extrabold text-slate-900">{props.title}</p>
        <p className="text-xs text-slate-500">{props.note}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={props.toggle.checked}
        disabled={props.toggle.disabled}
        onClick={() => props.toggle.onChange(!props.toggle.checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${
          props.toggle.checked ? "bg-[#2563EB]" : "bg-slate-200"
        } ${props.toggle.disabled ? "opacity-50" : ""}`}
      >
        <span className="sr-only">{props.title}</span>
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
            props.toggle.checked ? "left-6" : "left-1"
          }`}
        />
      </button>
    </li>
  );
}

export function NotificationSettingsPanel(props: { initial: NotificationSettings; loadFailed?: boolean }) {
  const [settings, setSettings] = useState<NotificationSettings>(props.initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // D-MT-12: 설정 조회 실패 시 폼을 비활성화한다. 실제 설정이 아닌 placeholder 를 저장해
  // 사용자의 기존 설정(예: 끈 알림)이 전부 on 으로 덮어써지는 것을 막는다.
  const loadFailed = props.loadFailed ?? false;

  async function save(next: NotificationSettings) {
    if (loadFailed) return; // placeholder 상태에서는 저장 금지(설정 유실 방지).
    setSaving(true);
    setError(null);
    setSaved(false);
    const fd = new FormData();
    if (next.pushEnabled) fd.set("push", "on");
    for (const key of NOTIFICATION_GROUPS) {
      if (next.groups[key]) fd.set(`group_${key}`, "on");
    }
    const res = await updateNotificationSettingsAction(fd);
    if (res.ok) {
      // DB 저장 성공에만 상태 확정·성공 표시.
      setSettings(next);
      setSaved(true);
    } else {
      // 저장 실패 → 성공 UI 금지, 이전 상태 유지, 오류 표시.
      setError(res.error);
    }
    setSaving(false);
  }

  function togglePush(v: boolean) {
    void save({ ...settings, pushEnabled: v });
  }
  function toggleGroup(key: (typeof NOTIFICATION_GROUPS)[number], v: boolean) {
    void save({ ...settings, groups: { ...settings.groups, [key]: v } });
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-black text-slate-900">알림 설정</h2>
      <p className="mt-1 text-xs font-medium leading-relaxed text-slate-600">
        푸시 알림 채널과 종류별 수신 여부를 설정할 수 있어요. 변경 즉시 저장됩니다.
      </p>

      {loadFailed ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
          현재 설정을 불러오지 못했어요. 잘못된 값으로 덮어쓰지 않도록 변경을 잠시 막아 두었어요. 새로고침해 다시 시도해 주세요.
        </p>
      ) : error ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-900">{error}</p>
      ) : saved ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-900">
          저장되었습니다.
        </p>
      ) : null}

      <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-100">
        <ToggleRow
          title="푸시 알림 전체"
          note="끄면 모든 종류의 푸시가 발송되지 않아요"
          toggle={{ label: "push", checked: settings.pushEnabled, onChange: togglePush, disabled: saving || loadFailed }}
        />
        {NOTIFICATION_GROUPS.map((key) => (
          <ToggleRow
            key={key}
            title={NOTIFICATION_GROUP_LABELS[key].label}
            note={NOTIFICATION_GROUP_LABELS[key].note}
            toggle={{
              label: key,
              checked: settings.pushEnabled && settings.groups[key],
              onChange: (v) => toggleGroup(key, v),
              disabled: saving || loadFailed || !settings.pushEnabled,
            }}
          />
        ))}
      </ul>
    </section>
  );
}
