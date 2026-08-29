import Link from "next/link";
import { AuthPageLayout } from "@/components/auth/AuthPageLayout";
import { UpdatePasswordClient } from "@/components/auth/UpdatePasswordClient";

export default function AuthUpdatePasswordPage() {
  return (
    <AuthPageLayout
      noCard
      loginLayout
      title="비밀번호 변경"
      description={
        <p>
          <span className="md:hidden">재설정 링크로 접속한 경우에만 동작해요.</span>
          <span className="hidden md:inline">이메일로 받은 재설정 링크를 통해 접속한 경우에만 아래 폼이 동작합니다.</span>
        </p>
      }
      headerPrefix={
        <Link href="/login" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
          ← 로그인
        </Link>
      }
    >
      <div className="mx-auto w-full max-w-lg px-2">
        <UpdatePasswordClient />
      </div>
    </AuthPageLayout>
  );
}
