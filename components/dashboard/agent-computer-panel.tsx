"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  HardDrive,
  Info,
  Loader2,
  LogIn,
  Maximize2,
  Minimize2,
  Monitor,
  Pause,
  Play,
  PowerOff,
  RefreshCw,
  Shield,
  ShieldAlert,
  UserCheck,
  X,
} from "lucide-react";

export type ComputerStatusData = {
  isEligible: boolean;
  campaignStatus: "active" | "ended";
  computer: {
    id: number;
    agentId: string;
    status: string;
    controlMode: "agent" | "human";
    activeTaskId?: number | null;
    pausedAt?: string | null;
    lastActiveAt?: string | null;
    lastScreenshotAt?: string | null;
    lastScreenshotBase64?: string | null;
    error?: string | null;
  } | null;
  activeTask: {
    id: number;
    status: string;
    currentStepIndex: number;
    activityDescription?: string | null;
    waitingReason?: string | null;
    waitingSince?: string | null;
  } | null;
  artifacts: Array<{
    id: number;
    filename: string;
    sandboxPath: string;
    sizeBytes: number;
    mimeType: string;
    artifactType: string;
    imagekitUrl?: string | null;
    isVerified: boolean;
    createdAt: string;
  }>;
};

export type StreamData = {
  streamUrl: string;
  controlMode: "agent" | "human";
  viewOnly: boolean;
};

function formatArtifactSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 10) return `${kb.toFixed(1)} KB`;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function AgentComputerPanel({
  agentId,
  agentRole,
  campaignId,
  campaignName,
}: {
  agentId: string;
  agentRole: string;
  campaignId: number;
  campaignName: string;
}) {
  const [statusData, setStatusData] = useState<ComputerStatusData | null>(null);
  const [streamData, setStreamData] = useState<StreamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [streamLoading, setStreamLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Close expanded view on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isExpanded) {
        setIsExpanded(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isExpanded]);

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(
        `/api/computer/status?agentId=${encodeURIComponent(agentId)}&campaignId=${campaignId}`,
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load computer status.");
      }
      if (isMountedRef.current) {
        setStatusData(data);
      }
      return data as ComputerStatusData;
    } catch (err: unknown) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
      return null;
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [agentId, campaignId]);

  const fetchStreamUrl = useCallback(async () => {
    try {
      setStreamLoading(true);
      setStreamError(null);
      const res = await fetch("/api/computer/stream-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, campaignId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Unable to establish desktop stream connection.");
      }
      if (isMountedRef.current) {
        setStreamData({
          streamUrl: data.streamUrl,
          controlMode: data.controlMode,
          viewOnly: data.viewOnly,
        });
      }
    } catch (err: unknown) {
      if (isMountedRef.current) {
        setStreamError(err instanceof Error ? err.message : String(err));
        setStreamData(null);
      }
    } finally {
      if (isMountedRef.current) {
        setStreamLoading(false);
      }
    }
  }, [agentId, campaignId]);

  // Initial load
  useEffect(() => {
    setLoading(true);
    fetchStatus().then((data) => {
      if (data?.computer && data.computer.status === "running") {
        void fetchStreamUrl();
      } else {
        setStreamData(null);
      }
    });
  }, [fetchStatus, fetchStreamUrl]);

  // Poll status periodically (every 4s) when running or active
  useEffect(() => {
    const isRunning =
      statusData?.computer?.status === "running" ||
      statusData?.activeTask?.status === "active" ||
      statusData?.activeTask?.status === "waiting_for_user";

    if (!isRunning) return;

    const interval = setInterval(() => {
      void fetchStatus();
    }, 4000);

    return () => clearInterval(interval);
  }, [fetchStatus, statusData?.computer?.status, statusData?.activeTask?.status]);

  // Handle Takeover
  const handleTakeover = async (isLoginAction = false) => {
    try {
      setActionLoading(isLoginAction ? "login" : "takeover");
      setError(null);
      const res = await fetch("/api/computer/takeover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, campaignId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Takeover failed.");
      }
      await fetchStatus();
      await fetchStreamUrl();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  };

  const handleStartComputer = async () => {
    try {
      setActionLoading("start");
      setError(null);
      const res = await fetch("/api/computer/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, campaignId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to start computer.");
      }
      await fetchStatus();
      await fetchStreamUrl();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  };

  const handleStopComputer = async () => {
    try {
      setActionLoading("stop");
      setError(null);
      const res = await fetch("/api/computer/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, campaignId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to stop computer.");
      }
      setStreamData(null);
      await fetchStatus();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  };


  // Handle Handback
  const handleHandback = async () => {
    try {
      setActionLoading("handback");
      setError(null);
      const res = await fetch("/api/computer/handback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, campaignId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Handback failed.");
      }
      await fetchStatus();
      await fetchStreamUrl();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="agent-computer-loading">
        <Loader2 className="animate-spin" size={24} />
        <span>Loading {agentRole} desktop computer…</span>
      </div>
    );
  }

  const computer = statusData?.computer;
  const activeTask = statusData?.activeTask;
  const artifacts = statusData?.artifacts || [];
  const isRunning = computer?.status === "running";
  const isHumanControl = computer?.controlMode === "human";
  const isWaitingForUser =
    activeTask?.status === "waiting_for_user" || isHumanControl;
  const isPaused = Boolean(computer?.pausedAt);
  const isEnded = statusData?.campaignStatus === "ended";

  // Compute status badge
  let statusBadgeText = "Stopped";
  let statusBadgeClass = "is-stopped";

  if (isEnded) {
    statusBadgeText = "Campaign Ended";
    statusBadgeClass = "is-failed";
  } else if (computer?.error || computer?.status === "error") {
    statusBadgeText = "Error";
    statusBadgeClass = "is-failed";
  } else if (isWaitingForUser) {
    statusBadgeText = "Waiting for You";
    statusBadgeClass = "is-waiting";
  } else if (isPaused) {
    statusBadgeText = "Paused";
    statusBadgeClass = "is-paused";
  } else if (isRunning) {
    statusBadgeText = "Running";
    statusBadgeClass = "is-running";
  } else if (activeTask?.status === "completed") {
    statusBadgeText = "Done";
    statusBadgeClass = "is-completed";
  }

  return (
    <div className="agent-computer-container" aria-label={`${agentRole} Computer`}>
      {/* Top Banner / Error notification */}
      {error && (
        <div className="agent-computer-alert is-error" role="alert">
          <AlertCircle size={15} />
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {/* Campaign Ended Alert */}
      {isEnded && (
        <div className="agent-computer-alert is-warning" role="alert">
          <ShieldAlert size={15} />
          <span>This campaign has ended. Computer sandboxes have been safely terminated.</span>
        </div>
      )}

      {/* Main Header & Status Bar */}
      <div className="agent-computer-header">
        <div className="agent-computer-header-info">
          <div className="agent-computer-header-title">
            <Monitor size={17} className="agent-computer-icon" />
            <strong>{agentRole} Cloud Desktop</strong>
            <span className={`agent-computer-badge ${statusBadgeClass}`}>
              <i aria-hidden="true" />
              {statusBadgeText}
            </span>
          </div>
          <small className="agent-computer-meta">
            Campaign: {campaignName} · Sandboxed Linux MicroVM
          </small>
        </div>

        {/* Action Controls */}
        <div className="agent-computer-actions">
          {isRunning && !isEnded && (
            <>
              {isHumanControl ? (
                <button
                  type="button"
                  className="agent-computer-btn is-primary"
                  onClick={handleHandback}
                  disabled={Boolean(actionLoading)}
                  title="Return desktop control to the agent"
                >
                  {actionLoading === "handback" ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <UserCheck size={13} />
                  )}
                  <span>Hand Back to Agent</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="agent-computer-btn is-warning"
                    onClick={() => handleTakeover(false)}
                    disabled={Boolean(actionLoading)}
                    title="Take over the desktop mouse and keyboard"
                  >
                    {actionLoading === "takeover" ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Shield size={13} />
                    )}
                    <span>Take Over</span>
                  </button>
                  <button
                    type="button"
                    className="agent-computer-btn is-secondary"
                    onClick={() => handleTakeover(true)}
                    disabled={Boolean(actionLoading)}
                    title="Log into accounts or handle CAPTCHAs"
                  >
                    {actionLoading === "login" ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <LogIn size={13} />
                    )}
                    <span>Login Now</span>
                  </button>
                </>
              )}

              <button
                type="button"
                className="agent-computer-btn is-ghost"
                onClick={() => {
                  void fetchStatus();
                  void fetchStreamUrl();
                }}
                disabled={streamLoading || Boolean(actionLoading)}
                title="Refresh screen connection"
              >
                <RefreshCw size={13} className={streamLoading ? "animate-spin" : ""} />
                <span>Refresh Stream</span>
              </button>

              <button
                type="button"
                className="agent-computer-btn is-ghost"
                onClick={handleStopComputer}
                disabled={Boolean(actionLoading)}
                title="Stop and terminate this cloud desktop"
              >
                {actionLoading === "stop" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <PowerOff size={13} />
                )}
                <span>Stop</span>
              </button>
            </>
          )}

          {!isRunning && !isEnded && (
            <button
              type="button"
              className="agent-computer-btn is-primary"
              onClick={handleStartComputer}
              disabled={Boolean(actionLoading)}
              title="Launch and start this cloud desktop"
            >
              {actionLoading === "start" ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Play size={13} />
              )}
              <span>Start Computer</span>
            </button>
          )}
        </div>
      </div>

      {/* Control Mode Banner */}
      {isRunning && !isEnded && (
        <div
          className={`agent-computer-mode-banner ${
            isHumanControl ? "is-human" : "is-agent"
          }`}
        >
          {isHumanControl ? (
            <>
              <ShieldAlert size={15} />
              <div>
                <strong>Human Takeover Active (Interactive Mode)</strong>
                <p>
                  You have full mouse and keyboard control. Agent actions are
                  strictly halted server-side until you click <em>Hand Back</em>.
                </p>
              </div>
            </>
          ) : (
            <>
              <Info size={15} />
              <div>
                <strong>Agent in Control (View-Only Mode)</strong>
                <p>
                  Observing autonomous computer reasoning. Mouse and keyboard
                  inputs are locked to the agent to avoid race conditions. Click{" "}
                  <em>Take Over</em> if you wish to intervene.
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Desktop Stream Viewport */}
      <div className="agent-computer-stream-card">
        {isRunning && streamData?.streamUrl ? (
          <div className="agent-computer-stream-wrapper">
            <div className="agent-computer-stream-toolbar">
              <button
                type="button"
                className="agent-computer-expand-btn"
                onClick={() => setIsExpanded(true)}
                title="Expand to larger view"
              >
                <Maximize2 size={12} />
                <span>Expand View</span>
              </button>
            </div>
            <iframe
              src={streamData.streamUrl}
              className="agent-computer-stream-frame"
              title={`${agentRole} live cloud desktop stream`}
              allow="clipboard-read; clipboard-write; fullscreen"
              sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-modals"
            />
          </div>
        ) : streamLoading ? (
          <div className="agent-computer-stream-empty">
            <Loader2 className="animate-spin" size={28} />
            <strong>Connecting to live desktop stream…</strong>
            <p>Negotiating authenticated VNC tunnel with the sandbox microVM.</p>
          </div>
        ) : streamError ? (
          <div className="agent-computer-stream-empty is-error">
            <AlertCircle size={28} />
            <strong>Desktop stream unavailable</strong>
            <p>{streamError}</p>
            <button
              type="button"
              className="agent-computer-btn is-secondary"
              onClick={() => void fetchStreamUrl()}
            >
              <RefreshCw size={13} />
              <span>Retry Connection</span>
            </button>
          </div>
        ) : computer?.lastScreenshotBase64 ? (
          <div className="agent-computer-screenshot-preview">
            <div className="agent-computer-screenshot-banner">
              <span>
                <Camera size={13} style={{ display: "inline", verticalAlign: "middle", marginRight: 5 }} />
                {isPaused ? "Paused Screen Preview" : "Last Saved Screen Preview"}
                {computer.lastScreenshotAt && (
                  <small> (captured {new Date(computer.lastScreenshotAt).toLocaleTimeString()})</small>
                )}
              </span>
              <span className="agent-computer-screenshot-tag">Static Snapshot</span>
            </div>
            <img
              src={`data:image/png;base64,${computer.lastScreenshotBase64}`}
              alt={`${agentRole} last saved desktop screen`}
              className="agent-computer-screenshot-img"
            />
          </div>
        ) : (
          <div className="agent-computer-stream-empty">
            <Monitor size={36} />
            <strong>{isPaused ? "Computer Paused" : "No active desktop session"}</strong>
            <p>
              {isPaused
                ? "This computer was automatically paused due to inactivity. It will resume when a new task is assigned."
                : "The cloud desktop will launch automatically when the Master Agent delegates a research or content preparation task to this specialist."}
            </p>
            <small>E2B sandbox microVMs are spun up on-demand to conserve resources.</small>
            {!isEnded && (
              <button
                type="button"
                className="agent-computer-btn is-primary"
                onClick={handleStartComputer}
                disabled={Boolean(actionLoading)}
                style={{ marginTop: 12 }}
              >
                {actionLoading === "start" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Play size={13} />
                )}
                <span>Launch Cloud Desktop</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Expanded Desktop Stream Modal */}
      {isExpanded && streamData?.streamUrl && (
        <div
          className="agent-computer-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={`${agentRole} Desktop Stream Expanded View`}
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsExpanded(false);
          }}
        >
          <div className="agent-computer-modal-dialog">
            <div className="agent-computer-modal-header">
              <div className="agent-computer-modal-header-info">
                <Monitor size={17} />
                <strong>{agentRole} Cloud Desktop — Expanded View</strong>
                <span className={`agent-computer-badge ${statusBadgeClass}`}>
                  <i aria-hidden="true" />
                  {isHumanControl ? "Interactive Control" : "View-Only"}
                </span>
              </div>
              <button
                type="button"
                className="agent-computer-modal-close"
                onClick={() => setIsExpanded(false)}
                title="Close expanded view (Esc)"
              >
                <X size={15} />
                <span>Close (Esc)</span>
              </button>
            </div>
            <div className="agent-computer-modal-body">
              <iframe
                src={streamData.streamUrl}
                className="agent-computer-modal-frame"
                title={`${agentRole} expanded desktop stream`}
                allow="clipboard-read; clipboard-write; fullscreen"
                sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-modals"
              />
            </div>
          </div>
        </div>
      )}

      {/* Activity & Task Progress */}
      {activeTask && (
        <div className="agent-computer-activity-card">
          <div className="agent-computer-activity-header">
            <strong>Current Assignment</strong>
            <span className="agent-computer-step-tag">
              Step {activeTask.currentStepIndex || 1}
            </span>
          </div>
          <p className="agent-computer-activity-desc">
            {activeTask.activityDescription || "Executing autonomous desktop actions..."}
          </p>
          {activeTask.waitingReason && (
            <div className="agent-computer-waiting-callout">
              <Clock size={13} />
              <span>Waiting: {activeTask.waitingReason}</span>
            </div>
          )}
        </div>
      )}

      {/* Artifacts & Verified Files Section */}
      <div className="agent-computer-artifacts-card">
        <div className="agent-computer-artifacts-header">
          <div className="agent-computer-artifacts-title">
            <HardDrive size={15} />
            <strong>Verified Artifacts & Output Files</strong>
            <span className="agent-computer-artifacts-count">
              {artifacts.length} {artifacts.length === 1 ? "file" : "files"}
            </span>
          </div>
          <small className="agent-computer-artifacts-note">
            Downloaded artifacts are verified and saved to <strong>Durable Storage</strong> (persisting after sandbox termination).
            Temporary scratch files inside the sandbox <code>/home/user</code> directory will be cleared when the session stops.
          </small>
        </div>

        {artifacts.length === 0 ? (
          <p className="agent-computer-artifacts-empty">
            No artifacts exported yet. Files prepared in the sandbox will appear here
            once verified.
          </p>
        ) : (
          <ul className="agent-computer-artifacts-list">
            {artifacts.map((art) => (
              <li key={art.id} className="agent-computer-artifact-item">
                <div className="agent-computer-artifact-info">
                  {art.imagekitUrl || art.artifactType === "image" || art.mimeType?.startsWith("image/") ? (
                    <img
                      src={art.imagekitUrl || `/api/computer/artifacts/download?campaignId=${campaignId}&artifactId=${art.id}&view=1`}
                      alt={art.filename}
                      className="agent-computer-artifact-thumb"
                      style={{ width: 28, height: 28, borderRadius: 6, objectFit: "cover" }}
                    />
                  ) : (
                    <CheckCircle2 size={14} className="agent-computer-verified-icon" />
                  )}
                  <span className="agent-computer-artifact-name">{art.filename}</span>
                  <small className="agent-computer-artifact-size">
                    ({formatArtifactSize(art.sizeBytes)}) · {art.artifactType}
                  </small>
                  <span
                    className="agent-computer-storage-badge is-durable"
                    title="Verified and saved to durable storage; persists after sandbox termination"
                  >
                    <Shield size={10} />
                    <span>Durable</span>
                  </span>
                </div>
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  {(art.imagekitUrl || art.artifactType === "image" || art.mimeType?.startsWith("image/")) && (
                    <a
                      href={art.imagekitUrl || `/api/computer/artifacts/download?campaignId=${campaignId}&artifactId=${art.id}&view=1`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="agent-computer-artifact-download"
                      title="View hosted asset"
                    >
                      <ExternalLink size={13} />
                      <span>View</span>
                    </a>
                  )}
                  <a
                    href={`/api/computer/artifacts/download?campaignId=${campaignId}&artifactId=${art.id}`}
                    className="agent-computer-artifact-download"
                    download={art.filename}
                    title={`Download ${art.filename}`}
                  >
                    <Download size={13} />
                    <span>Download</span>
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

