"use client";

import { useId, useRef, useState } from "react";

type Props = {
  /**
   * 폼 제출 시 파일이 실릴 FormData 키. 생략하면 input 이 name 없이 렌더돼
   * 파일이 폼 제출(FormData)에 **구조적으로** 포함되지 않는다 — staged-upload
   * 소비처(숏폼 등: 서명 티켓으로 Storage 직접 업로드 후 ref 만 제출)용.
   * 액션이 `formData.get(name)` 으로 File 을 읽는 소비처는 반드시 name 을 지정할 것.
   */
  name?: string;
  accept: string;
  multiple?: boolean;
  required?: boolean;
  buttonLabel: string;
  hint?: string;
  maxFiles?: number;
  disabled?: boolean;
  onFilesChange?: (files: FileList | null) => void;
};

export function CommunityFileDropzone(props: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function syncLabel(files: FileList | null) {
    props.onFilesChange?.(files);
    if (!files?.length) {
      setLabel(null);
      return;
    }
    if (props.multiple) {
      const names = Array.from(files)
        .slice(0, props.maxFiles ?? files.length)
        .map((f) => f.name);
      setLabel(`${names.length}개 선택 · ${names.join(", ")}`);
      return;
    }
    setLabel(files[0]?.name ?? null);
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    syncLabel(e.target.files);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const input = inputRef.current;
    if (!input) return;
    input.files = e.dataTransfer.files;
    syncLabel(input.files);
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        name={props.name}
        accept={props.accept}
        multiple={props.multiple}
        required={props.required}
        disabled={props.disabled}
        onChange={onChange}
        className="sr-only"
      />
      <div
        role="button"
        tabIndex={props.disabled ? -1 : 0}
        aria-disabled={props.disabled}
        onKeyDown={(e) => {
          if (props.disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onClick={() => {
          if (props.disabled) return;
          inputRef.current?.click();
        }}
        onDragOver={(e) => {
          if (props.disabled) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={props.disabled ? undefined : onDrop}
        className={[
          "flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors",
          props.disabled
            ? "cursor-not-allowed border-slate-200 bg-slate-50/60 opacity-60"
            : dragOver
              ? "cursor-pointer border-[#2563EB] bg-blue-50/40"
              : "cursor-pointer border-slate-200 bg-slate-50/60 hover:border-slate-300 hover:bg-slate-50",
        ].join(" ")}
      >
        <span className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800">
          {props.buttonLabel}
        </span>
        <p className="mt-2 text-xs text-slate-500">{props.hint ?? "클릭하거나 파일을 끌어다 놓으세요"}</p>
      </div>
      {label ? <p className="text-xs font-semibold text-slate-700">{label}</p> : null}
    </div>
  );
}
