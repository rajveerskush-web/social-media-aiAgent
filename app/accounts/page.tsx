import { Users } from "lucide-react";
import { DashboardPlaceholder } from "@/components/dashboard/dashboard-placeholder";
import { getDashboardPageContext } from "@/lib/dashboard-page";

export default async function AccountsPage() {
  const context = await getDashboardPageContext();
  return <DashboardPlaceholder {...context} title="Accounts" description="Your connected social channels and account details will be managed here." icon={Users} />;
}
