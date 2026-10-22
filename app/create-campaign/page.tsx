import { CampaignWizard } from "@/components/campaign/campaign-wizard";
import { officeOptions } from "@/lib/campaign-options";
import { getAuthenticatedUser } from "@/lib/insforge/server";
import { redirect } from "next/navigation";

export default async function CreateCampaignPage({ searchParams }: { searchParams: Promise<{ campaignDeleted?: string }> }) {
  const { campaignDeleted } = await searchParams;
  const user = await getAuthenticatedUser();
  if (!user?.id) redirect("/sign-in");
  return <CampaignWizard userName={user.profile?.name?.trim() || user.email || "there"} offices={[...officeOptions]} campaignDeletedNotice={campaignDeleted === "1"} />;
}
