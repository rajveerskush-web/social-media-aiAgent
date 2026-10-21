import { ChartNoAxesCombined } from "lucide-react";
import { DashboardPlaceholder } from "@/components/dashboard/dashboard-placeholder";
import { getDashboardPageContext } from "@/lib/dashboard-page";

export default async function AnalyticsPage() {
  const context = await getDashboardPageContext();
  return <DashboardPlaceholder {...context} title="Analytics" description="Campaign performance and audience insights will appear here." icon={ChartNoAxesCombined} />;
}
