import { getAuthenticatedWorkspaceData } from "@/lib/insforge/server";
import { getOfficeOptionByStoredId } from "@/lib/campaign-options";
import { getOfficeAgents } from "@/lib/office-agents";
import { getDb, posts } from "@/db";
import { count, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { SociafyDashboard } from "@/components/dashboard/soto-dashboard";

type DashboardPageProps = {
  searchParams: Promise<{ profile?: string; campaignDeleted?: string }>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { campaignDeleted } = await searchParams;
  const { user, storedCampaign, campaigns, storedProfile } = await getAuthenticatedWorkspaceData();
  if (!user) redirect("/sign-in");
  if (!storedCampaign) redirect("/create-campaign");
  const selectedOffice = getOfficeOptionByStoredId(storedCampaign.officeImage);
  const officeSceneType = selectedOffice?.sceneType ?? null;
  const [recentContentData, officeAgents] = await Promise.all([
    getRecentContent(storedProfile?.id),
    getOfficeAgents(officeSceneType),
  ]);
  // Unknown saved values stay unavailable; never silently show a different office.

  return (
    <SociafyDashboard
      user={user}
      storedCampaign={storedCampaign}
      campaigns={campaigns}
      storedProfile={storedProfile}
      recentContent={recentContentData.items}
      recentContentCount={recentContentData.count}
      contentReadError={recentContentData.error}
      selectedOffice={selectedOffice}
      officeSceneType={officeSceneType}
      officeAgents={officeAgents}
      campaignDeletedNotice={campaignDeleted === "1"}
    />
  );
}

async function getRecentContent(authorId?: number) {
  const empty = { items: [] as Array<{ id: number; title: string; content: string | null; createdAt: Date }>, count: 0, error: false };
  if (!authorId) return empty;

  try {
    const db = getDb();
    const [items, [total]] = await Promise.all([
      db.select({ id: posts.id, title: posts.title, content: posts.content, createdAt: posts.createdAt })
        .from(posts)
        .where(eq(posts.authorId, authorId))
        .orderBy(desc(posts.createdAt))
        .limit(6),
      db.select({ total: count() }).from(posts).where(eq(posts.authorId, authorId)),
    ]);
    return { items, count: total.total, error: false };
  } catch {
    return { ...empty, error: true };
  }
}
