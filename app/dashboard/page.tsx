import { signOut } from "@/app/actions/auth";
import { getAuthenticatedUser, getAuthenticatedUserProfile } from "@/lib/insforge/server";
import Link from "next/link";
import { redirect } from "next/navigation";

type DashboardPageProps = {
  searchParams: Promise<{ profile?: string }>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/sign-in");

  const { profile } = await searchParams;
  const storedProfile = await getAuthenticatedUserProfile();
  const displayName = storedProfile?.name?.trim() || user.profile?.name?.trim() || user.email;

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <Link className="auth-brand" href="/">
          <span className="auth-brand-mark">S</span>
          <span>SOTO</span>
        </Link>
        <form action={signOut}>
          <button className="dashboard-signout" type="submit">Sign out</button>
        </form>
      </header>
      <section className="dashboard-content">
        <span className="auth-eyebrow">Your workspace</span>
        <h1>Welcome, {displayName}</h1>
        <p>You’re signed in as {user.email}. Your account is ready.</p>
        {(profile === "pending" || !storedProfile) && (
          <p role="status">
            You are signed in, but your SOTO profile could not be saved yet. Profile saving will retry on your next sign-in.
          </p>
        )}
        <div className="dashboard-panel">
          <span className="dashboard-status-dot" />
          <span>Authenticated with InsForge</span>
        </div>
      </section>
    </main>
  );
}
