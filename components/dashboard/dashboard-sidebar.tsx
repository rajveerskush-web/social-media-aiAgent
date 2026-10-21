"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bot,
  Calendar,
  Check,
  ChevronDown,
  FileText,
  Flame,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Rocket,
  Settings,
  Sparkles,
  Target,
  BrainCircuit,
  Users,
} from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { selectCampaign } from "@/app/actions/campaign";

type SidebarUser = {
  email: string;
  profile?: { name?: string | null } | null;
};

type SidebarCampaign = {
  id: number;
  name: string;
  iconKey?: string | null;
  iconImage?: string | null;
};

const navigationItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, tone: "orange" },
  { href: "/ai-agent", label: "AI Agent", icon: Bot, tone: "violet" },
  { href: "/posts", label: "Posts", icon: FileText, tone: "blue" },
  { href: "/calendar", label: "Calendar", icon: Calendar, tone: "green" },
  { href: "/analytics", label: "Analytics", icon: Sparkles, tone: "pink" },
  { href: "/accounts", label: "Accounts", icon: Users, tone: "cyan" },
  { href: "/settings", label: "Settings", icon: Settings, tone: "slate" },
];

export function DashboardSidebar({ user, storedCampaign, campaigns, profileName }: { user: SidebarUser; storedCampaign: SidebarCampaign | null; campaigns: SidebarCampaign[]; profileName?: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [showCampaignDropdown, setShowCampaignDropdown] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const [isSwitching, startSwitch] = useTransition();
  const displayName = profileName?.trim() || user.profile?.name?.trim() || user.email;
  const firstName = displayName.split(/[\s@]/)[0] || "there";
  const CampaignIcon = storedCampaign?.iconKey === "rocket"
    ? Rocket
    : storedCampaign?.iconKey === "target"
      ? Target
      : storedCampaign?.iconKey === "brain"
        ? BrainCircuit
        : Flame;

  function openCampaignWizard() {
    setShowCampaignDropdown(false);
    router.push("/create-campaign");
  }

  function changeCampaign(campaignId: number) {
    startSwitch(async () => {
      const result = await selectCampaign(campaignId);
      if (result.error) {
        setSwitchError(result.error);
        return;
      }
      setSwitchError("");
      setShowCampaignDropdown(false);
      router.refresh();
    });
  }

  return (
    <aside className={`soto-sidebar ${isCollapsed ? "is-collapsed" : "is-expanded"}`}>
      <div className="soto-brand-header">
        <Link href="/" className="soto-brand-link" aria-label="SOTO AI home">
          <span className="soto-brand-logo-mark"><Sparkles size={16} /></span>
          <span className="soto-brand-text">SOTO<span className="soto-brand-ai"> AI</span></span>
        </Link>
        <button
          type="button"
          className="soto-sidebar-toggle"
          onClick={() => setIsCollapsed((collapsed) => !collapsed)}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </div>

      <div className="soto-campaign-card-wrap">
        <button
          type="button"
          className="soto-campaign-card"
          onClick={() => setShowCampaignDropdown((shown) => !shown)}
          aria-label="Current campaign switcher"
          aria-expanded={showCampaignDropdown}
          aria-haspopup="true"
          title={isCollapsed ? storedCampaign?.name ?? "No campaign selected" : undefined}
        >
          <span className="soto-campaign-icon-badge">
            {storedCampaign?.iconImage ? (
              <Image src={storedCampaign.iconImage} alt="" width={16} height={16} unoptimized />
            ) : <CampaignIcon size={15} />}
          </span>
          <span className="soto-campaign-details">
            <span className="soto-campaign-label">CAMPAIGN</span>
            <strong className="soto-campaign-name">{storedCampaign?.name ?? "No campaign selected"}</strong>
          </span>
          <ChevronDown size={14} className={`soto-campaign-chevron ${showCampaignDropdown ? "is-open" : ""}`} />
        </button>
        {showCampaignDropdown && (
          <div className="soto-campaign-dropdown">
            <div className="soto-campaign-dropdown-info">
              <small>Current Campaign</small>
              <strong>{storedCampaign?.name ?? "No campaign selected"}</strong>
            </div>
            <div className="soto-campaign-options" aria-label="Your campaigns">
              {campaigns.length > 0 ? campaigns.map((item) => {
                const isSelected = storedCampaign?.id === item.id;
                const ItemIcon = item.iconKey === "rocket" ? Rocket
                  : item.iconKey === "target" ? Target
                    : item.iconKey === "brain" ? BrainCircuit
                      : Flame;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`soto-dropdown-link soto-campaign-choice ${isSelected ? "is-selected" : ""}`}
                    onClick={() => changeCampaign(item.id)}
                    disabled={isSelected || isSwitching}
                    aria-pressed={isSelected}
                  >
                    <span className="soto-campaign-choice-icon">
                      {item.iconImage ? <Image src={item.iconImage} alt="" width={16} height={16} unoptimized /> : <ItemIcon size={14} />}
                    </span>
                    <span className="soto-campaign-choice-name">{item.name}</span>
                    {isSelected && <Check size={14} className="soto-campaign-choice-check" />}
                  </button>
                );
              }) : <p className="soto-campaign-empty">No campaigns yet. Create one to get started.</p>}
            </div>
            {switchError && <p className="soto-campaign-switch-error" role="alert">{switchError}</p>}
            <div className="soto-dropdown-separator" />
            <button type="button" onClick={openCampaignWizard} className="soto-dropdown-link">
              <Plus size={14} /> Create new campaign
            </button>
          </div>
        )}
      </div>

      <span className="soto-sidebar-section-label">WORKSPACE</span>
      <nav className="soto-nav-list" aria-label="Workspace navigation">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`soto-nav-item soto-nav-${item.tone} ${isActive ? "is-active" : ""}`}
              title={isCollapsed ? item.label : undefined}
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
            >
              <span className="soto-nav-icon"><Icon size={16} strokeWidth={isActive ? 2.2 : 1.75} /></span>
              <span className="soto-nav-text">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="soto-sidebar-footer">
        <div className="soto-user-profile-strip">
          <div className="soto-user-avatar">{firstName.slice(0, 1).toUpperCase()}</div>
          <div className="soto-user-meta">
            <strong className="soto-user-display-name">{displayName}</strong>
            <small className="soto-user-email">{user.email}</small>
          </div>
          <form action={signOut}>
            <button type="submit" className="soto-signout-btn" aria-label="Sign out" title="Sign out">
              <LogOut size={15} />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
