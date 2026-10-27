import { getDashboardPageContext } from "@/lib/dashboard-page";
import { getOfficeOptionByStoredId } from "@/lib/campaign-options";
import { getOfficeAgents } from "@/lib/office-agents";
import { AiAgentsWorkspace } from "@/components/dashboard/ai-agents-workspace";

export default async function AiAgentPage() {
  const context = await getDashboardPageContext();
  const office = getOfficeOptionByStoredId(context.storedCampaign.officeImage);
  const sceneType = office?.sceneType ?? null;
  const agents = await getOfficeAgents(sceneType);

  return (
    <AiAgentsWorkspace
      user={context.user}
      storedCampaign={context.storedCampaign}
      campaigns={context.campaigns}
      profileName={context.profileName}
      agents={agents}
      office={office ? { title: office.title, sceneType: office.sceneType } : null}
    />
  );
}
