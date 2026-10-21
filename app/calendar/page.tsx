import { CalendarDays } from "lucide-react";
import { DashboardPlaceholder } from "@/components/dashboard/dashboard-placeholder";
import { getDashboardPageContext } from "@/lib/dashboard-page";

export default async function CalendarPage() {
  const context = await getDashboardPageContext();
  return <DashboardPlaceholder {...context} title="Calendar" description="Plan and review your campaign schedule in a clear, shared calendar." icon={CalendarDays} />;
}
