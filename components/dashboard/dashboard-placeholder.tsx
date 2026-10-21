import type { LucideIcon } from "lucide-react";
import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";

type PlaceholderProps = {
  title: string;
  description: string;
  icon: LucideIcon;
  user: { email: string; profile?: { name?: string | null } | null };
  storedCampaign: { id: number; name: string; iconKey?: string | null; iconImage?: string | null };
  campaigns: Array<{ id: number; name: string; iconKey?: string | null; iconImage?: string | null }>;
  profileName?: string | null;
};

export function DashboardPlaceholder({ title, description, icon: Icon, user, storedCampaign, campaigns, profileName }: PlaceholderProps) {
  return (
    <div className="soto-layout">
      <DashboardSidebar user={user} storedCampaign={storedCampaign} campaigns={campaigns} profileName={profileName} />
      <div className="soto-main-wrapper">
        <header className="soto-topbar">
          <div className="soto-topbar-heading">
            <span className="soto-placeholder-eyebrow">WORKSPACE</span>
            <h1 className="soto-page-title">{title}</h1>
          </div>
        </header>
        <main className="soto-canvas soto-placeholder-canvas">
          <section className="soto-placeholder-card" aria-labelledby="placeholder-title">
            <span className="soto-placeholder-icon"><Icon size={24} strokeWidth={1.8} /></span>
            <span className="soto-placeholder-badge">Coming soon</span>
            <h2 id="placeholder-title">{title} is on its way</h2>
            <p>{description}</p>
          </section>
        </main>
      </div>
    </div>
  );
}
