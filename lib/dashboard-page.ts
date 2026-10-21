import "server-only";
import { redirect } from "next/navigation";
import {
  getAuthenticatedUser,
  getAuthenticatedUserCampaign,
  getAuthenticatedUserCampaigns,
  getAuthenticatedUserProfile,
} from "@/lib/insforge/server";

export async function getDashboardPageContext() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/sign-in");

  const storedCampaign = await getAuthenticatedUserCampaign();
  if (!storedCampaign) redirect("/create-campaign");

  const storedProfile = await getAuthenticatedUserProfile();
  const campaigns = await getAuthenticatedUserCampaigns();
  return { user, storedCampaign, campaigns, profileName: storedProfile?.name ?? null };
}
