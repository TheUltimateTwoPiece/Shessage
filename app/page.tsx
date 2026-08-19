import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function Home() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return <SetupNotice />;
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  redirect(user ? "/chat" : "/login");
}

function SetupNotice() {
  return (
    <div className="flex h-dvh items-center justify-center bg-gray-50 p-6">
      <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
        <h1 className="text-xl font-bold text-blue-600">Shessage</h1>
        <p className="mt-3 text-sm text-gray-600">
          Supabase isn’t configured yet. Copy{" "}
          <code className="rounded bg-gray-100 px-1.5 py-0.5">.env.local.example</code>{" "}
          to{" "}
          <code className="rounded bg-gray-100 px-1.5 py-0.5">.env.local</code>{" "}
          and fill in your Supabase and LiveKit keys (see the README), then
          restart the dev server.
        </p>
      </div>
    </div>
  );
}
