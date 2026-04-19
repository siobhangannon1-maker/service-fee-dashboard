import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export default async function AccountInactivePage() {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set() {},
        remove() {},
      },
    }
  );

  await supabase.auth.signOut();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md rounded-3xl border bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-red-600">
          Account Deactivated
        </h1>

        <p className="mt-3 text-sm text-slate-600">
          Your account has been deactivated. Please contact your administrator
          if you believe this is a mistake.
        </p>
      </div>
    </main>
  );
}