"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Cpu,
  ExternalLink,
  HardDrive,
  Monitor,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import type { ComputerStatusData } from "./agent-computer-panel";

type SpecialistComputerSummary = {
  agentId: string;
  agentRole: string;
  computerStatus: string;
  controlMode: "agent" | "human";
  taskTitle: string | null;
  activityDesc: string | null;
  isWaiting: boolean;
  artifactsCount: number;
};

const ELIGIBLE_SPECIALISTS = [
  { id: "seat-1", role: "Research Specialist" },
  { id: "seat-mvj4q0fn", role: "Content Specialist" },
];

export function TeamComputersSection({
  campaignId,
  onOpenComputerTab,
}: {
  campaignId: number;
  onOpenComputerTab: (agentId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [computers, setComputers] = useState<SpecialistComputerSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTeamComputers = useCallback(async () => {
    try {
      const results = await Promise.all(
        ELIGIBLE_SPECIALISTS.map(async (spec) => {
          try {
            const res = await fetch(
              `/api/computer/status?agentId=${spec.id}&campaignId=${campaignId}`,
            );
            if (!res.ok) return null;
            const data: ComputerStatusData = await res.json();
            return {
              agentId: spec.id,
              agentRole: spec.role,
              computerStatus: data.computer?.status ?? "stopped",
              controlMode: data.computer?.controlMode ?? "agent",
              taskTitle: data.activeTask?.activityDescription ?? null,
              activityDesc: data.activeTask?.activityDescription ?? null,
              isWaiting:
                data.activeTask?.status === "waiting_for_user" ||
                data.computer?.controlMode === "human",
              artifactsCount: data.artifacts?.length ?? 0,
            };
          } catch {
            return null;
          }
        }),
      );

      const valid = results.filter(
        (r): r is SpecialistComputerSummary => r !== null,
      );
      setComputers(valid);
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    void fetchTeamComputers();
    const interval = setInterval(() => {
      void fetchTeamComputers();
    }, 6000);
    return () => clearInterval(interval);
  }, [fetchTeamComputers]);

  const activeCount = computers.filter(
    (c) => c.computerStatus === "running",
  ).length;
  const waitingCount = computers.filter((c) => c.isWaiting).length;

  return (
    <div className="team-computers-accordion" aria-label="Team Computers">
      <button
        type="button"
        className="team-computers-header"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <div className="team-computers-title">
          <Monitor size={15} className="team-computers-icon" />
          <strong>Team Cloud Desktops</strong>
          <span className="team-computers-counts">
            {activeCount > 0 ? (
              <span className="team-computers-pill is-active">
                {activeCount} Active
              </span>
            ) : (
              <span className="team-computers-pill is-idle">Idle</span>
            )}
            {waitingCount > 0 && (
              <span className="team-computers-pill is-waiting">
                {waitingCount} Waiting for You
              </span>
            )}
          </span>
        </div>
        <div className="team-computers-toggle">
          {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </div>
      </button>

      {isOpen && (
        <div className="team-computers-content">
          <p className="team-computers-caption">
            Isolated Linux desktop computers assigned to eligible specialists for web
            research and content production.
          </p>

          <div className="team-computers-grid">
            {ELIGIBLE_SPECIALISTS.map((spec) => {
              const comp = computers.find((c) => c.agentId === spec.id);
              const isRunning = comp?.computerStatus === "running";
              const isWaiting = comp?.isWaiting;

              return (
                <div key={spec.id} className="team-computer-card">
                  <div className="team-computer-card-top">
                    <div className="team-computer-info">
                      <strong>{spec.role}</strong>
                      <span
                        className={`team-computer-status-dot ${
                          isWaiting
                            ? "is-waiting"
                            : isRunning
                            ? "is-running"
                            : "is-stopped"
                        }`}
                      >
                        <i aria-hidden="true" />
                        {isWaiting
                          ? "Waiting for You"
                          : isRunning
                          ? "Running"
                          : "Stopped"}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="team-computer-open-btn"
                      onClick={() => onOpenComputerTab(spec.id)}
                      title={`Open ${spec.role} Computer view`}
                    >
                      <span>Open Desktop</span>
                      <ExternalLink size={12} />
                    </button>
                  </div>

                  <p className="team-computer-activity">
                    {comp?.activityDesc ||
                      (isRunning
                        ? "Active desktop session in progress."
                        : "Desktop sandbox is idle.")}
                  </p>

                  <div className="team-computer-card-footer">
                    <span className="team-computer-artifacts">
                      <HardDrive size={11} />
                      {comp?.artifactsCount || 0} artifacts
                    </span>
                    <span className="team-computer-mode">
                      {comp?.controlMode === "human" ? "Human Control" : "AI Control"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact Status Bar for Master Agent overview
 */
export function CompactMasterComputerBar({
  campaignId,
  onOpenComputerTab,
}: {
  campaignId: number;
  onOpenComputerTab: (agentId: string) => void;
}) {
  const [activeComputers, setActiveComputers] = useState<SpecialistComputerSummary[]>([]);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const results = await Promise.all(
          ELIGIBLE_SPECIALISTS.map(async (spec) => {
            const res = await fetch(
              `/api/computer/status?agentId=${spec.id}&campaignId=${campaignId}`,
            );
            if (!res.ok) return null;
            const data: ComputerStatusData = await res.json();
            if (data.computer?.status === "running") {
              return {
                agentId: spec.id,
                agentRole: spec.role,
                computerStatus: data.computer.status,
                controlMode: data.computer.controlMode,
                taskTitle: data.activeTask?.activityDescription ?? null,
                activityDesc: data.activeTask?.activityDescription ?? null,
                isWaiting:
                  data.activeTask?.status === "waiting_for_user" ||
                  data.computer.controlMode === "human",
                artifactsCount: data.artifacts?.length ?? 0,
              };
            }
            return null;
          }),
        );
        if (mounted) {
          const valid = results.filter((r): r is SpecialistComputerSummary => r !== null);
          setActiveComputers(valid);
          if (valid.length > 0) {
            setIsDismissed(false);
          }
        }
      } catch {
        // Non-fatal
      }
    };

    void check();
    const interval = setInterval(check, 6000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [campaignId]);

  if (activeComputers.length === 0 || isDismissed) return null;

  return (
    <div className="compact-master-computer-bar" role="status" aria-label="Active team computers">
      <div className="compact-computer-status-indicator">
        <span className="compact-computer-live-dot" aria-hidden="true" />
        <Monitor size={13} className="compact-computer-icon" />
        <span className="compact-computer-count">
          {activeComputers.length} Active Desktop{activeComputers.length > 1 ? "s" : ""}
        </span>
      </div>

      <div className="compact-computer-chips">
        {activeComputers.map((c) => {
          const shortRole = c.agentRole.replace(" Specialist", "");
          return (
            <button
              key={c.agentId}
              type="button"
              className={`compact-computer-pill ${c.isWaiting ? "is-waiting" : "is-running"}`}
              onClick={() => onOpenComputerTab(c.agentId)}
              title={`Open ${c.agentRole} computer (${c.isWaiting ? "Waiting for You" : "Active"})`}
            >
              <span className="compact-computer-pill-name">{shortRole}</span>
              <span className="compact-computer-pill-badge">
                {c.isWaiting ? "Waiting" : c.controlMode === "human" ? "Human" : "AI"}
              </span>
              <ArrowUpRight size={11} className="compact-computer-pill-arrow" />
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="compact-computer-dismiss-btn"
        onClick={() => setIsDismissed(true)}
        aria-label="Hide active computer status bar"
        title="Dismiss bar"
      >
        <X size={12} />
      </button>
    </div>
  );
}
