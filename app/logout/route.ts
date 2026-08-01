import { createClient } from "@/lib/supabase/server";
import { handleLogoutPost } from "@/lib/auth/logoutRoute";

// GET 은 export 하지 않는다 — Next.js 가 405 를 반환한다.
// (D-13: /logout 을 <Link> 로 렌더한 prefetch 가 GET 으로 세션을 파기하던 결함의 재발 방지)
export async function POST(request: Request) {
  const supabase = await createClient();
  return handleLogoutPost(request, { signOut: () => supabase.auth.signOut() });
}
