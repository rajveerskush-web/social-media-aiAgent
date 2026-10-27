import "server-only";
import { redirect } from "next/navigation";
import { getAuthenticatedWorkspaceData } from "@/lib/insforge/server";

export async function getDashboardPageContext() {
  const { user, storedCampaign, campaigns, storedProfile } = await getAuthenticatedWorkspaceData();
  if (!user) redirect("/sign-in");
  if (!storedCampaign) redirect("/create-campaign");
  return { user, storedCampaign, campaigns, profileName: storedProfile?.name ?? null };
}
