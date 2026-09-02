"use client";

/**
 * 서류 뷰어 — 관리자 심사용 독립 컴포넌트(PR-2 §3). 멘토 승인 화면이 먼저 쓰고, 학적 변경 화면 적용은 PR-3.
 *
 * - `storagePath` 는 컬럼값 그대로(버킷명 포함 경로). 서명 URL 은 서버가 발급한다
 *   (`initialSource` 로 미리 받거나 `refreshStudentIdDocumentAction` 으로 재요청).
 * - mimetype 분기: 이미지 → <img> · PDF → <iframe> · 모르면 <iframe> 폴백 + 새 탭 열기.
 *   (구 화면은 PDF 도 <img> 로 그려 깨진 이미지로 떨어졌다 — 그것이 PDF 가 안 보이던 원인이다.)
 * - 확대·축소 · 90도 회전 · 전체화면(F 단축키 이벤트) · 새 탭에서 원본 열기.
 * - 300KB 미만 "저해상도 · 판독 주의" 배지 · 로딩 표시 · 실패 시 재시도 + 새 탭 열기(빈 화면 금지) · 만료 전 재요청.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { refreshStudentIdDocumentAction } from "@/lib/admin/mentorApprovalDocumentActions";
import {
  DOCUMENT_LOW_RES_BADGE,
  DOCUMENT_VIEWER_FULLSCREEN_EVENT,
  DOCUMENT_ZOOM_DEFAULT,
  documentKindLabel,
  formatDocumentSize,
  isLowResolutionDocument,
  isSignedUrlExpired,
  rotateDocument,
  signedUrlRefreshDelayMs,
  stepDocumentZoom,
  type DocumentViewerSource,
} from "@/lib/admin/documentViewerModel";

export type DocumentViewerProps = {
  /** 컬럼값 그대로(버킷명 포함 경로) */
  storagePath: string;
  /** 저해상도 배지 판단용. 없으면 서버 메타(source.sizeBytes) */
  fileSizeBytes?: number | null;
  alt: string;
  /** 서버에서 미리 발급한 소스. 없으면 마운트 시 요청한다 */
  initialSource?: DocumentViewerSource | null;
  /** F 단축키(window 이벤트)로 전체화면을 토글할지 — 한 화면에 뷰어가 여럿이면 보이는 하나만 true */
  listenFullscreenShortcut?: boolean;
  className?: string;
};

type Phase = "loading" | "ready" | "error";

const REFRESH_FAILED_MESSAGE = "서류 링크를 다시 발급하지 못했습니다. 다시 시도해 주세요.";
const LOAD_FAILED_MESSAGE = "서류를 불러오지 못했습니다. 다시 시도하거나 새 탭에서 열어 주세요.";

/** 확대 단계 → Tailwind scale 유틸(인라인 style 금지 — 단계표는 documentViewerModel.DOCUMENT_ZOOM_STEPS 와 1:1). */
const ZOOM_CLASS: Record<string, string> = {
  "0.5": "scale-50",
  "0.75": "scale-75",
  "1": "scale-100",
  "1.25": "scale-125",
  "1.5": "scale-150",
  "2": "scale-200",
  "3": "scale-300",
};
/** 회전 → Tailwind rotate 유틸 */
const ROTATION_CLASS: Record<string, string> = {
  "0": "rotate-0",
  "90": "rotate-90",
  "180": "rotate-180",
  "270": "rotate-270",
};

const toolButton =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-slate-600 bg-slate-800 px-2 text-xs font-bold text-slate-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40";

export function DocumentViewer(props: DocumentViewerProps) {
  const { storagePath, fileSizeBytes, alt, initialSource = null, listenFullscreenShortcut = false, className } = props;

  const [source, setSource] = useState<DocumentViewerSource | null>(initialSource);
  const [phase, setPhase] = useState<Phase>(initialSource?.signedUrl ? "loading" : initialSource ? "error" : "loading");
  const [errorText, setErrorText] = useState<string | null>(initialSource && !initialSource.signedUrl ? initialSource.error : null);
  const [refreshing, setRefreshing] = useState(false);
  const [zoom, setZoom] = useState(DOCUMENT_ZOOM_DEFAULT);
  const [rotation, setRotation] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const mounted = useRef(true);
  const autoRetried = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setErrorText(null);
    try {
      const next = await refreshStudentIdDocumentAction(storagePath);
      if (!mounted.current) return;
      setSource(next);
      if (next.signedUrl) {
        setPhase("loading");
      } else {
        setPhase("error");
        setErrorText(next.error ?? REFRESH_FAILED_MESSAGE);
      }
    } catch {
      if (!mounted.current) return;
      setPhase("error");
      setErrorText(REFRESH_FAILED_MESSAGE);
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [storagePath]);

  // 서버가 소스를 주지 않았으면 마운트 시 발급한다(오류로 온 소스는 그대로 실패 상태로 보여 재시도를 맡긴다).
  // effect 본문에서 동기 setState 를 피하기 위해 다음 틱에 요청한다(react-hooks/set-state-in-effect).
  useEffect(() => {
    if (initialSource) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [initialSource, refresh]);

  // 서명 URL 만료 전 재요청(300초 TTL).
  useEffect(() => {
    const expiresAt = source?.expiresAt;
    if (!source?.signedUrl || typeof expiresAt !== "number") return;
    const timer = window.setTimeout(() => void refresh(), signedUrlRefreshDelayMs(expiresAt));
    return () => window.clearTimeout(timer);
  }, [source?.signedUrl, source?.expiresAt, refresh]);

  // F 단축키 → 전체화면 토글(단축키 핸들러가 window 에 dispatch).
  useEffect(() => {
    if (!listenFullscreenShortcut) return;
    const onToggle = () => setFullscreen((v) => !v);
    window.addEventListener(DOCUMENT_VIEWER_FULLSCREEN_EVENT, onToggle);
    return () => window.removeEventListener(DOCUMENT_VIEWER_FULLSCREEN_EVENT, onToggle);
  }, [listenFullscreenShortcut]);

  // 전체화면에서 Esc 로 나가기.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const url = source?.signedUrl ?? null;
  const kind = source?.kind ?? "unknown";
  const sizeBytes = typeof fileSizeBytes === "number" ? fileSizeBytes : source?.sizeBytes ?? null;
  const lowRes = isLowResolutionDocument(sizeBytes);

  const handleMediaError = () => {
    // 만료 직후의 실패는 한 번 자동 재발급, 그 외는 실패 표시(재시도 버튼).
    if (!autoRetried.current && isSignedUrlExpired(source?.expiresAt)) {
      autoRetried.current = true;
      void refresh();
      return;
    }
    setPhase("error");
    setErrorText(LOAD_FAILED_MESSAGE);
  };

  const transformClass = cn("origin-center transition-transform", ZOOM_CLASS[String(zoom)] ?? "scale-100", ROTATION_CLASS[String(rotation)] ?? "rotate-0");

  const body = (
    <div
      className={cn(
        "relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-slate-100",
        fullscreen ? "h-full" : "",
        className
      )}
      data-document-viewer
      data-document-kind={kind}
    >
      {/* 툴바 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
          <span className="rounded-md bg-slate-800 px-2 py-0.5 font-bold text-slate-200">{documentKindLabel(kind)}</span>
          <span className="tabular-nums text-slate-400">{formatDocumentSize(sizeBytes)}</span>
          {lowRes ? (
            <span className="rounded-md border border-amber-400/60 bg-amber-500/15 px-2 py-0.5 font-bold text-amber-200">{DOCUMENT_LOW_RES_BADGE}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1" role="toolbar" aria-label="서류 보기 도구">
          <button type="button" className={toolButton} onClick={() => setZoom((z) => stepDocumentZoom(z, -1))} aria-label="축소" title="축소">
            −
          </button>
          <button
            type="button"
            className={cn(toolButton, "tabular-nums")}
            onClick={() => setZoom(DOCUMENT_ZOOM_DEFAULT)}
            aria-label="배율 초기화"
            title="배율 초기화"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" className={toolButton} onClick={() => setZoom((z) => stepDocumentZoom(z, 1))} aria-label="확대" title="확대">
            +
          </button>
          <button type="button" className={toolButton} onClick={() => setRotation((r) => rotateDocument(r))} aria-label="90도 회전" title="90도 회전">
            ↻ 회전
          </button>
          <button
            type="button"
            className={toolButton}
            onClick={() => setFullscreen((v) => !v)}
            aria-pressed={fullscreen}
            aria-label={fullscreen ? "전체화면 닫기" : "전체화면"}
            title={fullscreen ? "전체화면 닫기 (Esc)" : "전체화면 (F)"}
          >
            {fullscreen ? "닫기" : "전체화면"}
          </button>
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" className={toolButton} title="새 탭에서 원본 열기">
              새 탭
            </a>
          ) : null}
        </div>
      </div>

      {/* 본문 */}
      <div className="relative min-h-0 flex-1 overflow-auto">
        {phase === "error" ? (
          <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm font-bold text-slate-100">불러오기 실패</p>
            <p className="max-w-sm text-xs text-slate-300">{errorText ?? LOAD_FAILED_MESSAGE}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  autoRetried.current = false;
                  void refresh();
                }}
                disabled={refreshing}
                className="rounded-xl bg-white px-4 py-2 text-sm font-extrabold text-slate-900 hover:bg-slate-200 disabled:opacity-60"
              >
                {refreshing ? "재시도 중…" : "재시도"}
              </button>
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-500 px-4 py-2 text-sm font-bold text-slate-100 hover:bg-slate-800">
                  새 탭에서 열기
                </a>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            {phase === "loading" ? (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-slate-900/70" aria-live="polite">
                <div className="flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-slate-100">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" aria-hidden />
                  {refreshing ? "서류 링크 갱신 중…" : "서류 불러오는 중…"}
                </div>
              </div>
            ) : null}
            {url ? (
              <div className="flex h-full min-h-[320px] items-center justify-center p-3">
                <div className="flex h-full w-full items-center justify-center" data-zoom={zoom} data-rotation={rotation}>
                  {kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- 서명 URL(외부 스토리지) · 확대·회전 transform 대상
                    <img
                      key={url}
                      src={url}
                      alt={alt}
                      onLoad={() => setPhase("ready")}
                      onError={handleMediaError}
                      className={cn("max-h-full max-w-full select-none object-contain", transformClass)}
                      draggable={false}
                    />
                  ) : (
                    <iframe
                      key={url}
                      src={url}
                      title={alt}
                      onLoad={() => setPhase("ready")}
                      className={cn("h-full min-h-[480px] w-full rounded-lg bg-white", transformClass)}
                    />
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[320px] items-center justify-center" />
            )}
          </>
        )}
      </div>
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-slate-950 p-3 sm:p-5" data-document-viewer-fullscreen>
        {body}
      </div>
    );
  }
  return body;
}
