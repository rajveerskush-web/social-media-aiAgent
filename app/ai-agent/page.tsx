import { Bot } from "lucide-react";
import { DashboardPlaceholder } from "@/components/dashboard/dashboard-placeholder";
import { getDashboardPageContext } from "@/lib/dashboard-page";

export default async function AiAgentPage() {
  const context = await getDashboardPageContext();
  return <DashboardPlaceholder {...context} title="AI Agent" description="Your AI teammates will help plan and create campaign content from one focused workspace." icon={Bot} />;
}
