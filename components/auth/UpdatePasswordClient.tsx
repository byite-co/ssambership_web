"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { mapSupabaseAuthError } from "@/lib/utils/mapSupabaseAuthError";

export function UpdatePasswordClient() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (pw.length < 8) {
      setErr("비밀번호는 8자 이상으로 설정해 주세요.");
      return;
    }
    if (pw !== pw2) {
      setErr("비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) {
        setErr(mapSupabaseAuthError(error.message));
        setLoading(false);
        return;
      }

      // D-AU-1: 재설정 세션의 역할을 읽어 역할별 로그인 경로로 보낸다.
      // (구 동작은 무조건 /login/student 로 보내, 멘토가 학생 로그인 카드에 서서
      //  역할 불일치 signOut 을 당했다.) 새 비밀번호로 다시 로그인하도록 재설정
      //  세션은 정리하고 이동한다.
      let loginPath = "/login/student";
      try {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData?.user?.id ?? null;
        if (uid) {
          const { data: prof } = await supabase
            .from("users")
            .select("role")
            .eq("id", uid)
            .maybeSingle();
          const role = (prof as { role?: string } | null)?.role;
          if (role === "mentor") loginPath = "/login/mentor";
          else if (role === "admin") loginPath = "/admin/login";
        }
      } catch {
        /* 역할 조회 실패 시 학생 로그인 폴백(기존 동작) */
      }
      try {
        await supabase.auth.signOut();
      } catch {
        /* */
      }

      setMsg("비밀번호가 변경되었습니다. 잠시 후 로그인 화면으로 이동합니다.");
      window.setTimeout(() => {
        window.location.assign(loginPath);
      }, 1200);
    } catch (ex) {
      setErr(mapSupabaseAuthError(ex instanceof Error ? ex.message : String(ex)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-black text-slate-900">새 비밀번호 설정</h2>
      <p className="hidden text-xs leading-relaxed text-slate-600 md:block">
        메일의 링크로 이 페이지에 들어온 경우에만 정상 동작합니다. 링크가 만료되었다면 비밀번호 찾기를 다시 요청해 주세요.
      </p>
      {err ? <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{err}</p> : null}
      {msg ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">{msg}</p> : null}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-sm font-bold text-slate-800" htmlFor="np1">
            새 비밀번호
          </label>
          <input
            id="np1"
            type="password"
            autoComplete="new-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            minLength={8}
            required
            disabled={loading}
          />
        </div>
        <div>
          <label className="text-sm font-bold text-slate-800" htmlFor="np2">
            새 비밀번호 확인
          </label>
          <input
            id="np2"
            type="password"
            autoComplete="new-password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            minLength={8}
            required
            disabled={loading}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-extrabold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "저장 중…" : "비밀번호 저장"}
        </button>
      </form>
      <p className="text-center text-sm">
        <Link href="/forgot-password" className="font-bold text-blue-700 underline">
          메일을 못 받았나요?
        </Link>
      </p>
    </div>
  );
}
