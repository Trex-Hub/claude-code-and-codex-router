import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-auth";
import Dashboard from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const store = await cookies();
  if (!verifySession(store.get(ADMIN_COOKIE)?.value)) {
    redirect("/login");
  }
  return <Dashboard />;
}
