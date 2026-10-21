import { Settings } from "lucide-react";
import { DashboardPlaceholder } from "@/components/dashboard/dashboard-placeholder";
import { getDashboardPageContext } from "@/lib/dashboard-page";

export default async function SettingsPage() {
  const context = await getDashboardPageContext();
  return <DashboardPlaceholder {...context} title="Settings" description="Workspace preferences and account settings will be available here." icon={Settings} />;
}
