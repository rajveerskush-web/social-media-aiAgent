import { FileText } from "lucide-react";
import { DashboardPlaceholder } from "@/components/dashboard/dashboard-placeholder";
import { getDashboardPageContext } from "@/lib/dashboard-page";

export default async function PostsPage() {
  const context = await getDashboardPageContext();
  return <DashboardPlaceholder {...context} title="Posts" description="Drafts and published campaign content will be organized here." icon={FileText} />;
}
