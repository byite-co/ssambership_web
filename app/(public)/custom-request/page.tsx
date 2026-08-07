import Link from "next/link";
import "./landing.css";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { CustomRequestHero } from "@/components/customRequest/CustomRequestHero";
import { CustomRequestSteps } from "@/components/customRequest/CustomRequestSteps";
import { CustomRequestCategoryGrid } from "@/components/customRequest/CustomRequestCategoryGrid";
import { CustomRequestPostListTable } from "@/components/customRequest/CustomRequestPostListTable";
import { CustomRequestTrustBanner } from "@/components/customRequest/CustomRequestTrustBanner";
import { createClient } from "@/lib/supabase/server";
import { loadRecentCustomRequestPosts } from "@/lib/customRequest/customRequestQueries";
import { isCustomRequestFeatureEnabled } from "@/lib/shell/featureFlags";

import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CustomRequestPublicPage() {
  const supabase = await createClient();
  const { user, profile } = await getServerUserWithProfile();
  const role = profile?.role ?? null;
  const isMentor = role === "mentor";
  const isLoggedIn = Boolean(user);

  // D-CR-8: 항상 빈 배열을 반환하던 사문 카테고리 로더 호출 제거 — 카테고리는 정적 상수(CustomRequestCategoryGrid).
  const recent = await loadRecentCustomRequestPosts(supabase, 3);

  const registerHref = isMentor ? "/mentor/custom-request/dashboard" : "/custom-request/new";
  const registerLabel = isMentor ? "내 진행 의뢰 보기" : "의뢰 요청 등록하기";

  return (
    <PageScaffold
      compactHero
      hideHero
      hideFooterPlaceholderCards
      eyebrow="맞춤의뢰"
      title="맞춤의뢰"
      description="요청을 올리고 멘토 제안을 비교한 뒤, 주문·상담까지 이어가요."
      ctas={
        isLoggedIn
          ? []
          : [{ href: `/login/student?next=${encodeURIComponent("/custom-request")}`, label: "학생 로그인", tone: "slate" }]
      }
      sections={[]}
      dataPoints={[]}
      emptyState=""
    >
      <div className="cr-landing">
        {/* [맞춤의뢰 출시 준비 중] 진입점은 네비/푸터/랜딩에서 숨김. 직접 접근 시 안내 배너.
            로컬·스테이징에서 NEXT_PUBLIC_FEATURE_CUSTOM_REQUEST=on 으로 배너 숨김 가능. */}
        {!isCustomRequestFeatureEnabled() ? (
          <div className="mx-auto mb-6 max-w-3xl rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-center">
            <p className="text-sm font-extrabold text-amber-900">맞춤의뢰는 곧 오픈 예정이에요</p>
            <p className="mt-1 text-xs font-medium leading-relaxed text-amber-800">
              지금은 준비 중이라 새 의뢰 등록이 잠시 제한돼요. 이미 진행 중인 주문은 그대로 이용할 수 있어요.
            </p>
          </div>
        ) : null}
        <CustomRequestHero role={role} />

        <section className="band scroll-mt-24" id="flow-steps" style={{ background: "#f3f6fc" }}>
          <div className="wrap">
            <CustomRequestSteps />
          </div>
        </section>

        <section className="band scroll-mt-24" id="categories">
          <div className="wrap">
            <CustomRequestCategoryGrid />
          </div>
        </section>

        <section className="band" style={{ background: "#f3f6fc", paddingBottom: 40 }}>
          <div className="wrap">
            <CustomRequestPostListTable list={recent} max={3} />
          </div>
        </section>

        <section className="band" style={{ background: "#f3f6fc", paddingTop: 16, paddingBottom: 64 }}>
          <div className="wrap">
            <div className="cta-dark">
              <span className="cglow cg1" aria-hidden />
              <span className="cglow cg2" aria-hidden />
              <h2>지금 바로 멘토에게 의뢰해 보세요</h2>
              <p>요청을 올리면 멘토들이 제안을 보내드려요. 제안 비교는 무료예요.</p>
              <Link href={registerHref} className="btn btn-white">
                {registerLabel}
              </Link>
            </div>
          </div>
        </section>

        <section className="band" style={{ paddingTop: 76, paddingBottom: 72 }}>
          <div className="wrap">
            <CustomRequestTrustBanner />
            <div className="navlinks">
              {isMentor ? (
                <>
                  <Link href="/mentor/custom-request/dashboard">내 진행 의뢰 대시보드 보기</Link>
                  <Link href="/mentor/custom-request/posts">새 의뢰 목록 보기</Link>
                </>
              ) : (
                <>
                  <Link href="/custom-request/orders">진행 중인 주문 보기</Link>
                  <Link href="/custom-request/posts">내 의뢰 목록</Link>
                  <Link href="/custom-request/new">의뢰 요청 등록으로 이동</Link>
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </PageScaffold>
  );
}
