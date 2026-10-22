"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Activity,
  BrainCircuit,
  Bell,
  CalendarClock,
  FilePlus2,
  FileText,
  Rocket,
  Search,
  Sparkles,
  Info,
  Plus,
  Target,
} from "lucide-react";
import { AiAgentOffice, type OfficeSceneType } from "@/components/dashboard/ai-agent-office";
import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";

type DashboardProps = {
  user: {
    email: string;
    profile?: {
      name?: string | null;
    } | null;
  };
  storedCampaign: {
    id: number;
    name: string;
    iconKey?: string | null;
    iconImage?: string | null;
    officeImage?: string | null;
  };
  campaigns: Array<{
    id: number;
    name: string;
    iconKey?: string | null;
    iconImage?: string | null;
  }>;
  storedProfile?: {
    id: number;
    name?: string | null;
  } | null;
  recentContent: Array<{
    id: number;
    title: string;
    content: string | null;
    createdAt: Date;
  }>;
  recentContentCount: number;
  contentReadError: boolean;
  selectedOffice?: {
    id: string;
    title: string;
    image: string;
    description?: string;
    sceneType: OfficeSceneType;
  };
  officeSceneType: OfficeSceneType | null;
  campaignDeletedNotice?: boolean;
};

export function SociafyDashboard({
  user,
  storedCampaign,
  campaigns,
  storedProfile,
  recentContent,
  recentContentCount,
  contentReadError,
  selectedOffice,
  officeSceneType,
  campaignDeletedNotice = false,
}: DashboardProps) {
  const [showContentModal, setShowContentModal] = useState(false);

  const displayName =
    storedProfile?.name?.trim() || user.profile?.name?.trim() || user.email;
  const firstName = displayName.split(/[\s@]/)[0] || "there";
  const CampaignIcon = storedCampaign.iconKey === "rocket"
    ? Rocket
    : storedCampaign.iconKey === "target"
      ? Target
      : storedCampaign.iconKey === "brain"
        ? BrainCircuit
        : Sparkles;

  return (
    <div className="soto-layout">
      {/* ===================== 2. SIDEBAR ===================== */}
      <DashboardSidebar user={user} storedCampaign={storedCampaign} campaigns={campaigns} profileName={storedProfile?.name} />

      {/* ===================== MAIN CONTENT WRAPPER ===================== */}
      <div className="soto-main-wrapper">
        {/* TOPBAR */}
        <header className="soto-topbar">
          <div className="soto-topbar-heading">
            <h1 className="soto-page-title">Overview</h1>
            <p className="soto-page-subtitle">A snapshot of your campaign at a glance</p>
          </div>

          <div className="soto-topbar-actions">
            {/* Search is visible in the reference but not yet backed by a search feature. */}
            <div className="soto-search-box soto-search-coming-soon" role="group" aria-label="Search, coming soon">
              <Search size={14} className="soto-search-icon" />
              <span className="soto-search-placeholder">Search campaigns, posts, or anything...</span>
              <span className="soto-search-status">Coming soon</span>
            </div>

            <button
              type="button"
              className="soto-icon-btn soto-notifications-btn"
              aria-label="Notifications coming soon"
              title="Notifications coming soon"
              disabled
            >
              <Bell size={17} />
            </button>

            <Link href="/posts" className="soto-primary-btn">
              <Plus size={16} aria-hidden="true" />
              <span>Create post</span>
            </Link>
          </div>
        </header>

        {/* Dashboard Canvas */}
        <main className="soto-canvas soto-overview-canvas">
          {campaignDeletedNotice && <p className="soto-campaign-success-notice" role="status">Campaign deleted successfully.</p>}
          <div className="soto-overview-layout">
            <div className="soto-overview-primary">
              <header className="soto-overview-intro">
                <p className="soto-overview-greeting">Good morning, {firstName}!</p>
                <h2>Your AI Creative Team is on it.</h2>
                <p>From trends to content to posting, your agents work together to turn ideas into real growth.</p>
              </header>

              <section className="soto-overview-section" aria-label="Selected campaign">
                <div className="soto-campaign-status-card">
                  <div className="soto-campaign-status-mark">
                    {storedCampaign.iconImage ? (
                      <Image src={storedCampaign.iconImage} alt="" width={28} height={28} unoptimized />
                    ) : (
                      <CampaignIcon size={22} aria-hidden="true" />
                    )}
                  </div>
                  <div className="soto-campaign-status-copy">
                    <strong>{storedCampaign.name}</strong>
                    <span>{selectedOffice?.description ?? "Your selected campaign workspace."}</span>
                  </div>
                  <span className="soto-campaign-status-badge"><i /> Selected</span>
                </div>
              </section>

              <div className="soto-overview-panels">
                <section className="soto-overview-card soto-overview-section" aria-labelledby="scheduled-posts-title">
                  <div className="soto-overview-card-heading">
                    <h3 id="scheduled-posts-title">Upcoming Posts</h3>
                    <Link href="/calendar" className="soto-overview-calendar-link">
                      View Calendar <span aria-hidden="true">&rarr;</span>
                    </Link>
                  </div>
                  <div className="soto-overview-empty-card">
                    <span className="soto-overview-empty-icon">
                      <CalendarClock size={20} />
                    </span>
                    <strong>No posts scheduled yet</strong>
                    <p>Schedule your first post to get started.</p>
                  </div>
                </section>

                <section className="soto-overview-card soto-overview-section" aria-labelledby="recent-activity-title">
                  <div className="soto-overview-card-heading">
                    <h3 id="recent-activity-title">Recent Activity</h3>
                  </div>
                  <div className="soto-overview-empty-card">
                    <span className="soto-overview-empty-icon">
                      <FileText size={20} />
                    </span>
                    <strong>No recent activity</strong>
                    <p>Your campaign activity will appear here.</p>
                  </div>
                </section>
              </div>

              <section className="soto-recent-content-card" aria-label="Recent saved content">
                <div className="soto-recent-content-header">
                  <div>
                    <h3 className="soto-panel-title">Recent saved content</h3>
                    <p className="soto-panel-subtitle">Posts saved to your account</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowContentModal(true)}
                    className="soto-text-action-btn"
                  >
                    View all ({recentContentCount}) &rarr;
                  </button>
                </div>

                {contentReadError ? (
                  <div className="soto-compact-empty">
                    <Info size={20} className="text-amber-500 mb-2" />
                    <strong>Unable to load saved content</strong>
                    <p>Check database connection to refresh saved posts.</p>
                  </div>
                ) : recentContent.length > 0 ? (
                  <div className="soto-posts-stack">
                    {recentContent.map((post) => (
                      <div key={post.id} className="soto-saved-post-row">
                        <span className="soto-post-type-icon">
                          <FilePlus2 size={15} />
                        </span>
                        <div className="soto-post-content-wrap">
                          <strong>{post.title}</strong>
                          <p>{post.content || "No preview content saved"}</p>
                        </div>
                        <time dateTime={post.createdAt.toISOString()}>
                          {new Intl.DateTimeFormat("en", {
                            month: "short",
                            day: "numeric",
                          }).format(post.createdAt)}
                        </time>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="soto-compact-empty">
                    <FileText size={22} className="soto-empty-glyph" />
                    <strong>No content created yet</strong>
                    <p>Saved posts will appear here once they are available in your workspace.</p>
                  </div>
                )}
              </section>

              <footer className="soto-dashboard-footer">
                <span className="soto-footer-text">
                  &copy; {new Date().getFullYear()} SOTO AI &middot; Workspace active for{" "}
                  <strong>{storedCampaign.name}</strong>
                </span>
              </footer>
            </div>
            <div className={`soto-overview-office-column ${officeSceneType === "modern" ? "is-modern" : ""}`}>
              <AiAgentOffice key={officeSceneType ?? "unavailable"} sceneType={officeSceneType} />
            </div>
          </div>
        </main>
      </div>

      {/* ===================== CAMPAIGN ASSETS MODAL ===================== */}
      {showContentModal && (
        <div
          className="soto-modal-backdrop"
          onClick={() => setShowContentModal(false)}
        >
          <div
            className="soto-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="soto-modal-top">
              <div>
                <h3 className="soto-modal-heading">Campaign and workspace</h3>
                <p className="soto-modal-sub">
                  {storedCampaign.name} — campaign office and account content
                </p>
              </div>
              <button
                type="button"
                className="soto-modal-close-btn"
                onClick={() => setShowContentModal(false)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <div className="soto-modal-body">
              {selectedOffice && (
                <div className="soto-modal-office-strip">
                  <div className="soto-modal-office-preview">
                    <Image
                      src={selectedOffice.image}
                      alt={selectedOffice.title}
                      fill
                      sizes="240px"
                      className="object-cover"
                    />
                  </div>
                  <div className="soto-modal-office-info">
                    <span className="soto-tag-pill">AI OFFICE</span>
                    <h4>{selectedOffice.title}</h4>
                    <p>{selectedOffice.description}</p>
                    <Link
                      href="/create-campaign"
                      className="soto-link-action"
                    >
                      Configure another campaign →
                    </Link>
                  </div>
                </div>
              )}

              <h4 className="soto-modal-section-h4">
                Saved account content ({recentContentCount})
              </h4>
              {recentContent.length > 0 ? (
                <div className="soto-modal-posts-list">
                  {recentContent.map((item) => (
                    <div key={item.id} className="soto-modal-post-item">
                      <span className="soto-modal-post-icon">
                        <FileText size={15} />
                      </span>
                      <div className="soto-modal-post-copy">
                        <strong>{item.title}</strong>
                        <p>{item.content || "No preview snippet available"}</p>
                      </div>
                      <time dateTime={item.createdAt.toISOString()}>
                        {new Intl.DateTimeFormat("en", {
                          month: "short",
                          day: "numeric",
                        }).format(item.createdAt)}
                      </time>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="soto-modal-empty-notice">
                  <FileText size={20} className="text-slate-400 mb-1" />
                  <strong>No saved content yet</strong>
                  <p>Saved posts will appear here as you add content to your workspace.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
