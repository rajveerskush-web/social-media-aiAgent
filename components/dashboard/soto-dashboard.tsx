"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Bell,
  Check,
  Clock,
  FilePlus2,
  FileText,
  Link2,
  Search,
  Send,
  Sparkles,
  Info,
} from "lucide-react";
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
  };
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
}: DashboardProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showContentModal, setShowContentModal] = useState(false);

  const displayName =
    storedProfile?.name?.trim() || user.profile?.name?.trim() || user.email;
  const firstName = displayName.split(/[\s@]/)[0] || "there";

  // Exactly three primary metric cards
  const metricCards = [
    {
      id: "scheduled",
      label: "Scheduled posts",
      value: "0",
      subtext: "Nothing queued yet",
      icon: Clock,
      iconBg: "#FFF3E8",
      iconColor: "#FF6B1A",
    },
    {
      id: "published",
      label: "Published",
      value: "0",
      subtext: "This month",
      icon: Send,
      iconBg: "#F5F3FF",
      iconColor: "#8B5CF6",
    },
    {
      id: "connected",
      label: "Connected accounts",
      value: "0",
      subtext: "Connect your first channel",
      icon: Link2,
      iconBg: "#ECFEFF",
      iconColor: "#06B6D4",
    },
  ];

  // Campaign checklist progress
  const hasSavedContent = recentContentCount > 0;
  const completedSteps = hasSavedContent ? 2 : 1;
  const progressPercent = Math.round((completedSteps / 3) * 100);

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
          </div>

          <div className="soto-topbar-actions">
            {/* Search */}
            <div className="soto-search-box">
              <Search size={14} className="soto-search-icon" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="soto-search-field"
              />
              <span className="soto-kbd-badge">⌘ F</span>
            </div>

            {/* Notification bell */}
            <button
              type="button"
              className="soto-icon-btn"
              aria-label="Notifications"
              title="Notifications"
            >
              <Bell size={16} />
              <span className="soto-notif-dot" />
            </button>

            {/* Generate post button */}
            <button
              type="button"
              onClick={() => setShowContentModal(true)}
              className="soto-primary-btn"
              title="Generate post for campaign"
            >
              <Sparkles size={14} />
              <span>Generate post</span>
            </button>
          </div>
        </header>

        {/* Dashboard Canvas */}
        <main className="soto-canvas">
          {/* ===================== 3. WELCOME BANNER ===================== */}
          <section className="soto-welcome-banner" aria-label="Campaign welcome">
            <div className="soto-banner-left">
              {/* Compact status indicator */}
              <div className="soto-banner-status">
                <span className="soto-status-pulse-dot" />
                <span>Agents online</span>
              </div>

              {/* Heading */}
              <h2 className="soto-banner-title">
                Welcome back, {firstName} 👋
              </h2>

              {/* Description */}
              <p className="soto-banner-subtitle">
                Your AI team for <strong>{storedCampaign.name}</strong> is set
                up in its new office and ready to start creating content.
              </p>
            </div>

            {/* Office Image */}
            <div className="soto-banner-right">
              <div className="soto-banner-office-frame">
                <Image
                  src={
                    selectedOffice?.image ||
                    "/offices/Screenshot%202026-10-18%20214546.png"
                  }
                  alt={selectedOffice?.title || "AI Agent Office"}
                  fill
                  priority
                  sizes="(max-width: 900px) 100vw, 360px"
                  className="object-cover"
                />
              </div>
            </div>
          </section>

          {/* ===================== 4. THREE PRIMARY METRIC CARDS ===================== */}
          <section
            className="soto-metric-grid-three"
            aria-label="Primary metric statistics"
          >
            {metricCards.map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.id} className="soto-metric-card">
                  <div className="soto-metric-top">
                    <span className="soto-metric-label">{card.label}</span>
                    <span
                      className="soto-metric-icon-box"
                      style={{
                        backgroundColor: card.iconBg,
                        color: card.iconColor,
                      }}
                    >
                      <Icon size={16} />
                    </span>
                  </div>
                  <div className="soto-metric-body">
                    <span className="soto-metric-value">{card.value}</span>
                  </div>
                  <span className="soto-metric-subtext">{card.subtext}</span>
                </div>
              );
            })}
          </section>

          {/* ===================== 5. CAMPAIGN SETUP CHECKLIST ===================== */}
          <section className="soto-setup-card" aria-label="Campaign setup checklist">
            <div className="soto-setup-header">
              <div className="soto-setup-title-group">
                <h3 className="soto-setup-title">Get your campaign running</h3>
                <p className="soto-setup-desc">
                  Complete these essential steps to activate your campaign.
                </p>
              </div>
              <div className="soto-setup-progress-meta">
                <span className="soto-setup-step-count">
                  {completedSteps} of 3 steps complete
                </span>
                <div className="soto-progress-bar-track">
                  <div
                    className="soto-progress-bar-fill"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Checklist Rows */}
            <div className="soto-checklist-rows">
              {/* Step 1: Create your campaign (COMPLETED) */}
              <div className="soto-checklist-row is-complete">
                <div className="soto-step-status-icon is-done">
                  <Check size={14} strokeWidth={2.5} />
                </div>
                <div className="soto-step-copy">
                  <strong className="soto-step-name">Create your campaign</strong>
                  <span className="soto-step-note">
                    {storedCampaign.name} is ready in your workspace
                  </span>
                </div>
                <span className="soto-step-badge is-done">Completed</span>
              </div>

              {/* Step 2: Connect a social account (COMING SOON) */}
              <div className="soto-checklist-row">
                <div className="soto-step-status-icon">
                  <Link2 size={14} />
                </div>
                <div className="soto-step-copy">
                  <strong className="soto-step-name">Connect a social account</strong>
                  <span className="soto-step-note">
                    Link your Instagram, Facebook, or LinkedIn channels
                  </span>
                </div>
                <span className="soto-step-badge is-pending">Coming soon</span>
              </div>

              {/* Step 3: Generate your first post */}
              <div
                className={`soto-checklist-row ${hasSavedContent ? "is-complete" : ""}`}
              >
                <div
                  className={`soto-step-status-icon ${hasSavedContent ? "is-done" : ""}`}
                >
                  {hasSavedContent ? (
                    <Check size={14} strokeWidth={2.5} />
                  ) : (
                    <Sparkles size={14} />
                  )}
                </div>
                <div className="soto-step-copy">
                  <strong className="soto-step-name">
                    Save your first post
                  </strong>
                  <span className="soto-step-note">
                    {hasSavedContent
                      ? `${recentContentCount} saved post${recentContentCount === 1 ? "" : "s"} on your account`
                      : "Create and save content to your workspace"}
                  </span>
                </div>
                {hasSavedContent ? (
                  <span className="soto-step-badge is-done">Completed</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowContentModal(true)}
                    className="soto-step-badge is-action"
                  >
                    View generator
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* ===================== 6. RECENT CONTENT (REAL STORED DATA) ===================== */}
          <section className="soto-recent-content-card" aria-label="Recent content">
            <div className="soto-recent-content-header">
              <div>
                <h3 className="soto-panel-title">Recent saved content</h3>
                <p className="soto-panel-subtitle">
                  Posts saved to your account
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowContentModal(true)}
                className="soto-text-action-btn"
              >
                View all ({recentContentCount}) →
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

          {/* Clean Dashboard Footer */}
          <footer className="soto-dashboard-footer">
            <span className="soto-footer-text">
              © {new Date().getFullYear()} SOTO AI • Workspace active for{" "}
              <strong>{storedCampaign.name}</strong>
            </span>
          </footer>
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
                  <p>When your AI agent generates posts, they will be saved here.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
