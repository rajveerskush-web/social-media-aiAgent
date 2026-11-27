"use client";

import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock,
  ExternalLink,
  HardDrive,
  Loader2,
  Monitor,
  Search,
  PenLine,
  CalendarDays,
  BarChart3,
  Sparkles,
  AlertCircle,
  WandSparkles,
  Activity,
  Layers,
} from "lucide-react";
import type { AgentActivityData, AgentExecutionStatus } from "@/lib/agent-activity";

import {
  formatExecutionStatus,
  formatElapsedTime,
} from "@/lib/agent-activity-format";

export { formatExecutionStatus, formatElapsedTime };

function RoleIcon({ role }: { role: string }) {
  const r = role.toLowerCase();
  if (r.includes("master")) return <WandSparkles size={14} />;
  if (r.includes("research")) return <Search size={14} />;
  if (r.includes("content")) return <PenLine size={14} />;
  if (r.includes("schedul")) return <CalendarDays size={14} />;
  if (r.includes("analytic") || r.includes("growth")) return <BarChart3 size={14} />;
  return <Sparkles size={14} />;
}

function getSpecialistTheme(role: string) {
  const r = role.toLowerCase();
  if (r.includes("research")) {
    return {
      gradient: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
      colorClass: "theme-research",
      typeLabel: "Research Specialist · Cloud microVM",
    };
  }
  if (r.includes("content")) {
    return {
      gradient: "linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)",
      colorClass: "theme-content",
      typeLabel: "Creative Specialist · Cloud microVM",
    };
  }
  if (r.includes("schedul")) {
    return {
      gradient: "linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)",
      colorClass: "theme-scheduler",
      typeLabel: "Campaign Scheduling Coordinator",
    };
  }
  if (r.includes("analytic") || r.includes("growth")) {
    return {
      gradient: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
      colorClass: "theme-analytics",
      typeLabel: "KPI Synthesis & Intelligence",
    };
  }
  return {
    gradient: "linear-gradient(135deg, #ff6b1a 0%, #fa5005 100%)",
    colorClass: "theme-master",
    typeLabel: "Master Agent Coordinator",
  };
}

export function AgentActivityPopover({
  agentId,
  agentRole,
  agentName,
  activity,
  onSelect,
  children,
  placement = "bottom",
}: {
  agentId: string;
  agentRole: string;
  agentName?: string;
  activity?: AgentActivityData | null;
  onSelect?: (agentId: string) => void;
  children?: ReactNode;
  placement?: "top" | "bottom";
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [dynamicPlacement, setDynamicPlacement] = useState<"top" | "bottom">(placement);
  const [horizontalShift, setHorizontalShift] = useState(0);
  const [verticalShift, setVerticalShift] = useState(0);

  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const execStatus = activity?.executionStatus ?? "ready";
  const { label: statusLabel, cssClass: statusClass } = formatExecutionStatus(execStatus);
  const theme = getSpecialistTheme(agentRole);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const triggerRect = trigger.getBoundingClientRect();
    const officeContainer = trigger.closest(".soto-agent-office-scene");
    const workspaceContainer = trigger.closest(".ai-agent-workspace");
    const isWorkspaceSelector = Boolean(
      trigger.closest(".ai-agent-selector") ||
      trigger.closest(".ai-agent-specialists") ||
      workspaceContainer
    );

    const windowWidth = typeof window !== "undefined" ? window.innerWidth : 1200;
    const windowHeight = typeof window !== "undefined" ? window.innerHeight : 800;

    // Safe boundaries: stay below fixed/sticky topbar and within window
    const viewportTop = 78;
    const viewportBottom = windowHeight - 12;
    const viewportSpaceAbove = Math.max(0, triggerRect.top - viewportTop);
    const viewportSpaceBelow = Math.max(0, viewportBottom - triggerRect.bottom);

    let effectiveSpaceAbove = viewportSpaceAbove;
    let effectiveSpaceBelow = viewportSpaceBelow;

    if (officeContainer) {
      const officeRect = officeContainer.getBoundingClientRect();
      const officeSpaceAbove = Math.max(0, triggerRect.top - officeRect.top);
      const officeSpaceBelow = Math.max(0, officeRect.bottom - triggerRect.bottom);
      effectiveSpaceAbove = Math.min(viewportSpaceAbove, officeSpaceAbove);
      effectiveSpaceBelow = Math.min(viewportSpaceBelow, officeSpaceBelow);
    }

    // Determine the optimal placement
    let nextPlacement: "top" | "bottom" = placement;
    if (isWorkspaceSelector) {
      // Workspace selector agent cards are positioned at the top of the page.
      // They MUST ALWAYS open downwards ("bottom") so they never clip into browser tabs or topbars.
      nextPlacement = "bottom";
    } else if (officeContainer) {
      const officeRect = officeContainer.getBoundingClientRect();
      const officeSpaceAbove = Math.max(0, triggerRect.top - officeRect.top);
      const officeSpaceBelow = Math.max(0, officeRect.bottom - triggerRect.bottom);

      // In the office scene, strictly respect upper/lower desk positioning
      if (placement === "bottom") {
        if (officeSpaceBelow < 200 && officeSpaceAbove >= 250 && officeSpaceAbove > officeSpaceBelow) {
          nextPlacement = "top";
        } else {
          nextPlacement = "bottom";
        }
      } else {
        if (officeSpaceAbove < 200 && officeSpaceBelow >= 250 && officeSpaceBelow > officeSpaceAbove) {
          nextPlacement = "bottom";
        } else {
          nextPlacement = "top";
        }
      }
    } else if (placement === "top") {
      nextPlacement = (effectiveSpaceAbove >= 260 || effectiveSpaceAbove >= effectiveSpaceBelow) ? "top" : "bottom";
    } else {
      nextPlacement = (effectiveSpaceBelow >= 240 || effectiveSpaceBelow >= effectiveSpaceAbove) ? "bottom" : "top";
    }
    setDynamicPlacement(nextPlacement);

    // Dynamic horizontal collision clamp within container/viewport
    const popoverWidth = popoverRef.current?.offsetWidth || 280;
    const triggerCenterX = triggerRect.left + triggerRect.width / 2;
    const idealLeft = triggerCenterX - popoverWidth / 2;
    const idealRight = triggerCenterX + popoverWidth / 2;

    let minLeft = 14;
    let maxRight = windowWidth - 14;

    if (officeContainer) {
      const officeRect = officeContainer.getBoundingClientRect();
      minLeft = officeRect.left + 10;
      maxRight = officeRect.right - 10;
    } else if (workspaceContainer) {
      const workspaceRect = workspaceContainer.getBoundingClientRect();
      minLeft = workspaceRect.left + 8;
      maxRight = workspaceRect.right - 8;
    }

    let hShift = 0;
    if (idealLeft < minLeft) {
      hShift = minLeft - idealLeft;
    } else if (idealRight > maxRight) {
      hShift = maxRight - idealRight;
    }
    setHorizontalShift(hShift);

    // Dynamic vertical collision clamp ensuring popover NEVER cuts out of office or viewport
    const popoverHeight = popoverRef.current?.offsetHeight || 310;
    let vShift = 0;

    if (isWorkspaceSelector) {
      // In workspace selector, popover opens below the card into the spacious workspace canvas.
      // It should NEVER translate upwards over the card or into the topbar.
      vShift = 0;
    } else if (officeContainer) {
      const officeRect = officeContainer.getBoundingClientRect();
      const minOfficeTop = officeRect.top + 8;
      const maxOfficeBottom = officeRect.bottom - 8;

      if (nextPlacement === "top") {
        const popoverTop = triggerRect.top - 9 - popoverHeight;
        if (popoverTop < minOfficeTop) {
          vShift = minOfficeTop - popoverTop;
          // Clamp so pushing down doesn't breach office bottom
          if (popoverTop + popoverHeight + vShift > maxOfficeBottom) {
            vShift = Math.max(0, maxOfficeBottom - (popoverTop + popoverHeight));
          }
        }
      } else {
        const popoverBottom = triggerRect.bottom + 9 + popoverHeight;
        if (popoverBottom > maxOfficeBottom) {
          vShift = maxOfficeBottom - popoverBottom;
          // Clamp so pushing up doesn't breach office top
          if (triggerRect.bottom + 9 + vShift < minOfficeTop) {
            vShift = minOfficeTop - (triggerRect.bottom + 9);
          }
        }
      }
    } else {
      const minViewportTop = 78;
      const maxViewportBottom = windowHeight - 12;

      if (nextPlacement === "top") {
        const popoverTop = triggerRect.top - 9 - popoverHeight;
        if (popoverTop < minViewportTop) {
          vShift = minViewportTop - popoverTop;
          if (popoverTop + popoverHeight + vShift > maxViewportBottom) {
            vShift = Math.max(0, maxViewportBottom - (popoverTop + popoverHeight));
          }
        }
      } else {
        const popoverBottom = triggerRect.bottom + 9 + popoverHeight;
        if (popoverBottom > maxViewportBottom) {
          vShift = maxViewportBottom - popoverBottom;
          // Crucial: NEVER shift up so much that the top of the popover breaches minViewportTop!
          if (triggerRect.bottom + 9 + vShift < minViewportTop) {
            vShift = minViewportTop - (triggerRect.bottom + 9);
          }
        }
      }
    }
    setVerticalShift(vShift);
  }, [placement]);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    timeoutRef.current = setTimeout(() => {
      updatePosition();
      setIsOpen(true);
    }, 90);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 200);
  };

  const handleToggleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isOpen) {
      updatePosition();
    }
    setIsOpen((prev) => !prev);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!isOpen) {
        updatePosition();
      }
      setIsOpen((prev) => !prev);
    } else if (e.key === "Escape" && isOpen) {
      setIsOpen(false);
    }
  };

  // Mount/unmount with smooth animation
  useEffect(() => {
    if (isOpen) {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      updatePosition();
      setIsMounted(true);
      const frameId = requestAnimationFrame(() => {
        updatePosition();
        requestAnimationFrame(() => {
          setIsVisible(true);
        });
      });
      return () => cancelAnimationFrame(frameId);
    } else {
      setIsVisible(false);
      closeTimerRef.current = setTimeout(() => {
        setIsMounted(false);
      }, 220);
    }
  }, [isOpen, updatePosition]);

  // Keep popover coordinates synchronized during resize or scroll
  useEffect(() => {
    if (!isOpen) return;
    const handleRecalculate = () => {
      updatePosition();
    };
    window.addEventListener("resize", handleRecalculate, { passive: true });
    window.addEventListener("scroll", handleRecalculate, { passive: true });
    return () => {
      window.removeEventListener("resize", handleRecalculate);
      window.removeEventListener("scroll", handleRecalculate);
    };
  }, [isOpen, updatePosition]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [isOpen]);

  const hasCurrentTask = Boolean(activity?.currentTask);
  const taskTitle = activity?.currentTask?.title ?? "No active task (Idle)";
  const elapsedMs = activity?.currentTask?.elapsedMs;

  const computerStatusText =
    activity?.computerStatus === "running"
      ? "MicroVM Active"
      : activity?.computerStatus === "waiting"
      ? "Waiting for Input"
      : activity?.computerStatus === "paused"
      ? "MicroVM Paused"
      : activity?.computerStatus === "stopped"
      ? "MicroVM Standby"
      : "Direct AI";

  return (
    <div
      className={`soto-agent-popover-wrapper ${isOpen ? "is-open" : ""}`}
      ref={triggerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={() => setIsOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsOpen(false);
        }
      }}
      tabIndex={0}
      role="region"
      aria-label={`Activity info for ${agentRole}`}
      onKeyDown={handleKeyDown}
    >
      {children ? (
        <div onClick={handleToggleClick} className="soto-agent-popover-trigger">
          {children}
        </div>
      ) : (
        <div
          onClick={handleToggleClick}
          className={`soto-agent-floating-indicator ${statusClass}`}
        >
          <span className="soto-agent-floating-dot" />
          <span className="soto-agent-floating-label">{agentRole}</span>
          {execStatus === "running" && (
            <span className="soto-agent-floating-sub">
              <Loader2 size={9} className="animate-spin" />
            </span>
          )}
        </div>
      )}

      {isMounted && (
        <div
          ref={popoverRef}
          className={`soto-agent-popover-card is-${dynamicPlacement} ${isVisible ? "is-visible" : "is-leaving"}`}
          style={{
            transform: `translate3d(calc(-50% + ${horizontalShift}px), ${
              verticalShift + (isVisible ? 0 : dynamicPlacement === "bottom" ? -7 : 7)
            }px, 0) scale(${isVisible ? 1 : 0.95})`,
          }}
          role="dialog"
          aria-modal="false"
          aria-label={`${agentRole} activity status`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Dynamic arrow notch tracking the trigger badge */}
          <span
            className="soto-unique-popover-arrow"
            style={{
              left: `${Math.max(20, Math.min(260, 140 - horizontalShift))}px`,
              opacity: Math.abs(verticalShift) > 18 ? 0 : 1,
            }}
            aria-hidden="true"
          />

          {/* Premium Header */}
          <div className="soto-agent-popover-header">
            <div className="soto-unique-popover-identity">
              <span className="soto-unique-popover-avatar" style={{ background: theme.gradient }}>
                <RoleIcon role={agentRole} />
              </span>
              <div className="soto-unique-popover-titles">
                <strong className="soto-unique-popover-name">{agentRole}</strong>
                <span className="soto-unique-popover-subname">{theme.typeLabel}</span>
              </div>
            </div>
            <span className={`soto-unique-popover-badge ${statusClass}`}>
              {execStatus === "running" && <span className="soto-unique-pulse-dot" />}
              {statusLabel}
            </span>
          </div>

          {/* Unique Task Card */}
          <div className="soto-unique-popover-body">
            <div className="soto-unique-task-card">
              <div className="soto-unique-task-header">
                <span className="soto-unique-task-label">
                  {execStatus === "running" ? (
                    <span className="soto-unique-radar-pulse" aria-hidden="true" />
                  ) : (
                    <Sparkles size={10} className="soto-unique-task-icon" />
                  )}
                  CURRENT ASSIGNMENT
                </span>
                {execStatus === "running" && <span className="soto-unique-live-tag">LIVE</span>}
              </div>
              <p className="soto-unique-task-title">{taskTitle}</p>
              {activity?.currentTask?.instructions && (
                <p className="soto-unique-task-desc">
                  {activity.currentTask.instructions.slice(0, 110)}
                  {activity.currentTask.instructions.length > 110 ? "…" : ""}
                </p>
              )}
            </div>

            {/* Live Telemetry Chips */}
            <div className="soto-unique-telemetry-row">
              <div className="soto-unique-chip" title="Active execution time">
                <Clock size={11} className="soto-unique-chip-icon" />
                <span>{formatElapsedTime(elapsedMs)}</span>
              </div>

              <div className="soto-unique-chip" title={computerStatusText}>
                <Monitor size={11} className="soto-unique-chip-icon" />
                <span>{computerStatusText}</span>
              </div>

              {activity?.artifactsCount !== undefined && activity.artifactsCount > 0 && (
                <div className="soto-unique-chip is-accent" title="Verified durable artifacts">
                  <HardDrive size={11} className="soto-unique-chip-icon" />
                  <span>{activity.artifactsCount} files</span>
                </div>
              )}
            </div>
          </div>

          {/* Signature Action Footer */}
          {onSelect && (
            <div className="soto-agent-popover-footer">
              <button
                type="button"
                className="soto-unique-action-btn"
                onClick={() => {
                  setIsOpen(false);
                  onSelect(agentId);
                }}
              >
                <span>Open Workspace</span>
                <ArrowRight size={13} className="soto-unique-action-arrow" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
