"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import type { FormEvent } from "react";
import { ArrowRight, ArrowUp, Bot, Check, CircleAlert, CircleDashed, ClipboardList, Download, ExternalLink, History, LoaderCircle, MessageCircle, Monitor, Search, Send, Settings, Sparkles, WandSparkles, AlertTriangle, Loader2, PowerOff } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { AiAgentOffice, type OfficeSceneType } from "@/components/dashboard/ai-agent-office";
import { FloatingTopbar } from "@/components/dashboard/floating-topbar";
import type { OfficeAgent } from "@/lib/office-agents";
import { isComputerEligible } from "@/lib/computer-types";
import { AgentComputerPanel } from "@/components/dashboard/agent-computer-panel";
import { TeamComputersSection, CompactMasterComputerBar } from "@/components/dashboard/team-computers-section";
import type { AgentActivityData } from "@/lib/agent-activity";
import { AgentActivityPopover, formatExecutionStatus } from "@/components/dashboard/agent-activity-popover";
import { formatTaskErrorMessage } from "@/lib/agent-activity-format";

type Tab = "chat" | "tasks" | "history" | "settings" | "computer";
type ChatMessage = { id: number | string; role: string; content: string; createdAt: string; requestKey?: string; animate?: boolean; sendState?: "pending" | "failed"; sendError?: string };
type WorkspaceTask = { id: number; title: string; instructions: string; dependencies: number[]; assignedAgentId: string; status: string; response?: string | null; error?: string | null; scheduledAt?: string; timeZone?: string | null; repeatRule?: { frequency: string; interval: number; timeZone: string } | null; nextRunAt?: string | null; createdAt: string };
type WorkspaceArtifact = { id: number; filename: string; mimeType: string; artifactType: string; sizeBytes: number; imagekitUrl?: string | null; sandboxPath?: string | null };
type TaskToast = { task: WorkspaceTask; completedCount: number; total: number };
const MASTER_AGENT: OfficeAgent = { id: "master-agent", name: "Master Agent", role: "Master Agent", avatar: null };

function normalizeMessageContent(
  content: string,
  campaignId: number,
  artifacts: WorkspaceArtifact[],
): string {
  if (!content) return "";
  let normalized = content;

  // 1. Rewrite any sandbox paths or View Asset File links like [View Asset File](/home/user/output/filename.png)
  normalized = normalized.replace(
    /\[(?:View Asset File|[^\]]+)\]\((\/home\/user\/[^\s)]+?(\.png|\.jpg|\.jpeg|\.webp|\.gif))\)/gi,
    (match, fullPath, ext) => {
      const filename = fullPath.split("/").pop();
      const matchedArt = artifacts.find((a) => a.filename === filename);
      const url = matchedArt?.imagekitUrl || (matchedArt ? `/api/computer/artifacts/download?campaignId=${campaignId}&artifactId=${matchedArt.id}&view=1` : fullPath);
      return `![${filename}](${url})\n\n[Download ${filename}](/api/computer/artifacts/download?campaignId=${campaignId}&artifactId=${matchedArt?.id || 0})`;
    }
  );

  // 2. Rewrite bare /home/user/output/... image paths
  normalized = normalized.replace(
    /(\/home\/user\/[^\s)"'`<>]+?(\.png|\.jpg|\.jpeg|\.webp|\.gif))/gi,
    (match, fullPath) => {
      const filename = fullPath.split("/").pop();
      const matchedArt = artifacts.find((a) => a.filename === filename);
      if (matchedArt) {
        return matchedArt.imagekitUrl || `/api/computer/artifacts/download?campaignId=${campaignId}&artifactId=${matchedArt.id}&view=1`;
      }
      return match;
    }
  );

  // 3. Ensure all image markdown links targeting artifact download route have &view=1 for inline display
  normalized = normalized.replace(
    /!\[([^\]]*)\]\((\/api\/computer\/artifacts\/download\?[^)]+)\)/g,
    (match, alt, url) => {
      if (!url.includes("view=1")) {
        const joiner = url.includes("?") ? "&" : "?";
        return `![${alt}](${url}${joiner}view=1)`;
      }
      return match;
    }
  );

  return normalized;
}

export function AiAgentsWorkspace({
  user, storedCampaign, campaigns, profileName, agents, office, mode = "page", selectedAgentId,
}: {
  user: { email: string; profile?: { name?: string | null } | null };
  storedCampaign: { id: number; name: string; iconKey?: string | null; iconImage?: string | null; officeImage?: string | null };
  campaigns: Array<{ id: number; name: string; iconKey?: string | null; iconImage?: string | null }>;
  profileName?: string | null;
  agents: OfficeAgent[];
  office: { title: string; sceneType: OfficeSceneType } | null;
  mode?: "page" | "embedded";
  selectedAgentId?: string;
}) {
  const [selectedId, setSelectedId] = useState("master-agent");
  const [tab, setTab] = useState<Tab>("chat");
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [campaignArtifacts, setCampaignArtifacts] = useState<WorkspaceArtifact[]>([]);
  const [taskToast, setTaskToast] = useState<TaskToast | null>(null);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [chatError, setChatError] = useState("");
  const [taskError, setTaskError] = useState("");
  const [showTaskScrollTop, setShowTaskScrollTop] = useState(false);
  const [showEndCampaignModal, setShowEndCampaignModal] = useState(false);
  const [endingCampaign, setEndingCampaign] = useState(false);
  const [endCampaignError, setEndCampaignError] = useState<string | null>(null);
  const [campaignEnded, setCampaignEnded] = useState(false);
  const [agentActivities, setAgentActivities] = useState<Record<string, AgentActivityData>>({});

  const fetchActivities = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/activity?campaignId=${storedCampaign.id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.agents) {
        setAgentActivities(data.agents);
      }
    } catch {
      // non-fatal
    }
  }, [storedCampaign.id]);

  useEffect(() => {
    void fetchActivities();
    const hasActiveWork = Object.values(agentActivities).some(
      (a) => a.executionStatus === "running" || a.executionStatus === "queued",
    );
    const intervalMs = hasActiveWork ? 2500 : 8000;
    const timer = setInterval(() => {
      void fetchActivities();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [fetchActivities, agentActivities]);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const taskListRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const autoScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversationLoadControllerRef = useRef<AbortController | null>(null);
  const autoScrollingRef = useRef(false);
  const initialPositionRef = useRef(true);
  const sendingRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const effectiveSelectedId = mode === "embedded" ? selectedAgentId : selectedId;
  const activeAgent = effectiveSelectedId === MASTER_AGENT.id ? MASTER_AGENT : agents.find((agent) => agent.id === effectiveSelectedId) ?? agents[0];
  const isMasterAgent = activeAgent?.id === MASTER_AGENT.id;
  const hasFinalReport = messages.some((m) =>
    m.role === "assistant" && (
      (m as unknown as { requestKey?: string })?.requestKey?.startsWith("final-report:") ||
      m.content.includes("Final Report") ||
      m.content.includes("Executive Summary")
    )
  );
  const hasUnfinishedTasks = tasks.some(
    (task) =>
      task.status === "running" ||
      ((task.status === "pending" || task.status === "queued" || task.status === "blocked") &&
        (!task.scheduledAt || Date.parse(task.scheduledAt) <= Date.now()))
  );
  const shouldPollChatTasks = hasUnfinishedTasks || (tasks.length > 0 && !hasFinalReport);
  const isEligibleForComputer = isComputerEligible(activeAgent?.id);
  const workspaceTabs = isMasterAgent
    ? ([ ["chat", "Chat", MessageCircle], ["tasks", "Tasks", ClipboardList], ["settings", "Settings", Settings] ] as const)
    : isEligibleForComputer
      ? ([ ["chat", "Chat", MessageCircle], ["computer", "Computer", Monitor], ["history", "History", History], ["settings", "Settings", Settings] ] as const)
      : ([ ["chat", "Chat", MessageCircle], ["history", "History", History], ["settings", "Settings", Settings] ] as const);
  const filteredAgents = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? agents.filter((agent) => `${agent.name} ${agent.role}`.toLocaleLowerCase().includes(needle)) : agents;
  }, [agents, query]);

  useEffect(() => {
    if (!activeAgent) { setMessages([]); return; }
    const controller = new AbortController();
    conversationLoadControllerRef.current = controller;
    initialPositionRef.current = true;
    setMessages([]);
    setTasks([]);
    if (taskToastTimerRef.current) clearTimeout(taskToastTimerRef.current);
    setTaskToast(null);
    setChatError("");
    setTaskError("");
    setConversationLoading(true);
    fetch(`/api/agent-chat?agentId=${encodeURIComponent(activeAgent.id)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load this conversation.");
        setMessages(payload.messages ?? []);
        setTasks(payload.tasks ?? []);
        if (payload.artifacts) setCampaignArtifacts(payload.artifacts);
        setTaskError("");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setChatError(error instanceof Error ? error.message : "Unable to load this conversation.");
        if (activeAgent.id === MASTER_AGENT.id) setTaskError(error instanceof Error ? error.message : "Unable to load tasks.");
      })
      .finally(() => {
        if (conversationLoadControllerRef.current === controller) conversationLoadControllerRef.current = null;
        if (!controller.signal.aborted) setConversationLoading(false);
      });
    return () => {
      controller.abort();
      if (conversationLoadControllerRef.current === controller) conversationLoadControllerRef.current = null;
    };
  }, [activeAgent?.id]);

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const maxHeight = 132;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [draft]);

  useEffect(() => {
    if (!sending || pendingAgentId !== MASTER_AGENT.id || tab !== "tasks") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();
    const pollTasks = async () => {
      try {
        const response = await fetch(`/api/agent-chat?agentId=${MASTER_AGENT.id}&tasksOnly=1`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to refresh tasks.");
        if (active) {
          setTasks(payload.tasks ?? []);
          setTaskError("");
        }
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) {
          setTaskError(error instanceof Error ? error.message : "Unable to refresh tasks.");
        }
      } finally {
        if (active) timer = setTimeout(pollTasks, 2000);
      }
    };
    timer = setTimeout(pollTasks, 1500);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      controller.abort();
    };
  }, [pendingAgentId, sending, tab]);

  useEffect(() => {
    if (!shouldPollChatTasks) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();
    const pollTasks = async () => {
      try {
        const url = activeAgent?.id === MASTER_AGENT.id
          ? `/api/agent-chat?agentId=${MASTER_AGENT.id}`
          : `/api/agent-chat?agentId=${MASTER_AGENT.id}&tasksOnly=1`;
        const response = await fetch(url, { signal: controller.signal });
        const payload = await response.json();
        if (response.ok && active) {
          setTasks(payload.tasks ?? []);
          if (payload.artifacts) setCampaignArtifacts(payload.artifacts);
          if (payload.messages && activeAgent?.id === MASTER_AGENT.id) {
            setMessages((current) => {
              const serverMessages: ChatMessage[] = payload.messages ?? [];
              if (serverMessages.length === current.length && serverMessages.every((sm, i) => sm.id === current[i]?.id)) {
                return current;
              }
              return serverMessages;
            });
          }
          void fetchActivities();
        }
      } catch {
      } finally {
        if (active) timer = setTimeout(pollTasks, 2500);
      }
    };
    timer = setTimeout(pollTasks, 1200);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      controller.abort();
    };
  }, [shouldPollChatTasks, activeAgent?.id, fetchActivities]);

  useEffect(() => () => {
    if (autoScrollTimerRef.current) clearTimeout(autoScrollTimerRef.current);
  }, []);

  useLayoutEffect(() => {
    const transcript = transcriptRef.current;
    if (tab !== "chat" || !transcript || conversationLoading || !shouldStickToBottomRef.current) return;
    const behavior = initialPositionRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    initialPositionRef.current = false;
    autoScrollingRef.current = behavior === "smooth";
    transcript.scrollTo({ top: transcript.scrollHeight, behavior });
    if (autoScrollTimerRef.current) clearTimeout(autoScrollTimerRef.current);
    if (behavior === "smooth") {
      autoScrollTimerRef.current = setTimeout(() => { autoScrollingRef.current = false; }, 450);
    }
  }, [messages, tasks, tab, sending, conversationLoading]);

  function interruptAutoScroll() {
    if (!autoScrollingRef.current) return;
    if (autoScrollTimerRef.current) clearTimeout(autoScrollTimerRef.current);
    autoScrollTimerRef.current = null;
    autoScrollingRef.current = false;
    const transcript = transcriptRef.current;
    shouldStickToBottomRef.current = Boolean(transcript && transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 72);
  }

  function selectAgent(id: string) {
    if (sendingRef.current || (id !== MASTER_AGENT.id && !agents.some((agent) => agent.id === id))) return;
    if (taskToastTimerRef.current) clearTimeout(taskToastTimerRef.current);
    setTaskToast(null);
    setSelectedId(id);
    if (tab === "computer" && !isComputerEligible(id)) {
      setTab("chat");
    }
  }

  async function refreshTasks(agentId: string) {
    try {
      const response = await fetch(`/api/agent-chat?agentId=${encodeURIComponent(agentId)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to refresh tasks.");
      setTasks(payload.tasks ?? []);
      setTaskError("");
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : "Unable to refresh tasks.");
    }
  }

  async function submitMessage(content: string, optimisticId: number | string, agentId: string, requestKey: string) {
    if (sendingRef.current) return;
    if (taskToastTimerRef.current) clearTimeout(taskToastTimerRef.current);
    setTaskToast(null);
    sendingRef.current = true;
    setSending(true);
    setPendingAgentId(agentId);
    shouldStickToBottomRef.current = true;
    setChatError("");
    setMessages((current) => current.map((message) => message.id === optimisticId
      ? { ...message, sendState: "pending", sendError: undefined }
      : message));
    try {
      const response = await fetch("/api/agent-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, message: content, requestKey }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The agent could not respond.");
      const persistedMessages: ChatMessage[] = (payload.messages ?? []).map((message: ChatMessage) => ({ ...message, animate: message.role === "assistant" }));
      setMessages((current) => {
        const optimisticIndex = current.findIndex((message) => message.id === optimisticId);
        const serverIds = new Set(persistedMessages.map((message) => message.id));
        const withoutDuplicates = current.filter((message) => message.id !== optimisticId && !serverIds.has(message.id));
        const insertionIndex = optimisticIndex < 0
          ? withoutDuplicates.length
          : current.slice(0, optimisticIndex).filter((message) => message.id !== optimisticId && !serverIds.has(message.id)).length;
        withoutDuplicates.splice(insertionIndex, 0, ...persistedMessages);
        return withoutDuplicates;
      });
      const updatedTasks: WorkspaceTask[] = payload.tasks ?? [];
      const previousTaskIds = new Set(tasks.map((task) => task.id));
      const newlyAssignedTasks = agentId === MASTER_AGENT.id ? updatedTasks.filter((task) => !previousTaskIds.has(task.id)) : [];
      setTasks(updatedTasks);
      void fetchActivities();
      if (newlyAssignedTasks.length) {
        const task = newlyAssignedTasks.find((item) => item.status === "running" || item.status === "pending" || item.status === "queued")
          ?? newlyAssignedTasks.find((item) => item.status === "failed" || item.status === "blocked")
          ?? newlyAssignedTasks[0];
        setTaskToast({ task, completedCount: newlyAssignedTasks.filter((item) => item.status === "completed").length, total: newlyAssignedTasks.length });
        taskToastTimerRef.current = setTimeout(() => setTaskToast(null), 6500);
      }
      setTaskError("");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Please try again in a moment.";
      setMessages((current) => current.map((message) => message.id === optimisticId
        ? { ...message, sendState: "failed", sendError: reason }
        : message));
      if (agentId === MASTER_AGENT.id) void refreshTasks(agentId);
    } finally {
      sendingRef.current = false;
      setSending(false);
      setPendingAgentId(null);
    }
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!activeAgent || !content || sendingRef.current) return;
    conversationLoadControllerRef.current?.abort();
    conversationLoadControllerRef.current = null;
    setConversationLoading(false);
    const requestKey = crypto.randomUUID();
    const optimisticId = `local-${requestKey}`;
    const optimisticMessage: ChatMessage = { id: optimisticId, requestKey, role: "user", content, createdAt: new Date().toISOString(), animate: true, sendState: "pending" };
    shouldStickToBottomRef.current = true;
    setMessages((current) => [...current, optimisticMessage]);
    setDraft("");
    void submitMessage(content, optimisticId, activeAgent.id, requestKey);
  }

  function retryMessage(message: ChatMessage) {
    if (!activeAgent || sendingRef.current || message.sendState !== "failed") return;
    if (!message.requestKey) return;
    void submitMessage(message.content, message.id, activeAgent.id, message.requestKey);
  }

  const handleConfirmEndCampaign = async () => {
    try {
      setEndingCampaign(true);
      setEndCampaignError(null);
      const res = await fetch("/api/campaign/end", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId: storedCampaign.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to end campaign.");
      }
      setCampaignEnded(true);
      setTimeout(() => {
        window.location.reload();
      }, 1200);
    } catch (err: unknown) {
      setEndCampaignError(err instanceof Error ? err.message : String(err));
    } finally {
      setEndingCampaign(false);
    }
  };

  const workspacePanel = (
    <section className="ai-agent-detail-card" aria-label={activeAgent ? `${activeAgent.role} workspace` : "Agent workspace"}>
      <header className="ai-agent-detail-header">
        {activeAgent ? <AgentAvatar agent={activeAgent} large /> : <span className="ai-agent-avatar-fallback"><Bot size={18} /></span>}
        <div className="ai-agent-detail-identity">
          <strong>{activeAgent?.role ?? "Agents unavailable"}</strong>
          <span>{isMasterAgent ? "Plans your requests, assigns tasks, and coordinates your team." : "Ready for questions and Master Agent assignments."}</span>
          {activeAgent && (
            <small
              className={`ai-agent-header-status is-${agentActivities[activeAgent.id]?.executionStatus ?? "ready"}`}
            >
              <i aria-hidden="true" />
              {formatExecutionStatus(agentActivities[activeAgent.id]?.executionStatus ?? "ready").label}
            </small>
          )}
        </div>
        <button type="button" className="ai-agent-header-settings" onClick={() => setTab("settings")} aria-label="Open agent settings" title="Settings"><Settings size={15} /><span>Settings</span></button>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className="ai-agent-campaign-label">{storedCampaign.name}</span>
          <button
            type="button"
            className="ai-agent-end-campaign-btn"
            onClick={() => setShowEndCampaignModal(true)}
            title="End this campaign and terminate active computers"
          >
            <PowerOff size={12} />
            <span>End Campaign</span>
          </button>
        </div>
      </header>
      <div className="ai-agent-tabs" role="tablist" aria-label="Agent workspace sections">
        {workspaceTabs.map(([id, label, Icon]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`ai-agent-tab ${tab === id ? "is-active" : ""}`} onClick={() => setTab(id)}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>
      <div className={`ai-agent-tab-panel ${tab === "computer" ? "is-computer" : ""}`} role="tabpanel">
        {tab === "chat" && <>
          <div className="ai-agent-transcript" ref={transcriptRef} aria-live="polite" onWheel={interruptAutoScroll} onTouchStart={interruptAutoScroll} onScroll={(event) => {
            if (autoScrollingRef.current) return;
            const element = event.currentTarget;
            shouldStickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
          }}>
            {conversationLoading && <p className="ai-agent-chat-note">Loading conversation…</p>}
            {!conversationLoading && messages.length === 0 && !sending && <div className="ai-agent-chat-welcome"><span><Sparkles size={18} /></span><strong>Chat with {activeAgent?.role ?? "your agent"}</strong><p>Messages are saved to this agent and campaign. Ask for help to get started.</p></div>}
            {messages.map((message) => <article key={message.id} className={`ai-agent-message ${message.role === "assistant" || message.role === "master" ? "is-agent" : "is-user"} ${message.animate ? "is-entering" : ""}`}>
              {(message.role === "assistant" || message.role === "master") && activeAgent && <AgentAvatar agent={message.role === "master" ? MASTER_AGENT : activeAgent} />}
              <div className="ai-agent-message-body">
                <div className="ai-agent-message-content">
                  <div className="ai-agent-message-markdown">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        img: ({ src, alt }) => {
                          const srcUrl = typeof src === "string" ? src : "";
                          const filename = (alt || srcUrl.split("/").pop()?.split("?")[0] || "image.png").trim();
                          const downloadHref = srcUrl.includes("/api/computer/artifacts/download")
                            ? srcUrl.replace(/([?&])view=1(&|$)/, "$1").replace(/[?&]$/, "")
                            : srcUrl;

                          return (
                            <span className="ai-agent-chat-image-card">
                              <span className="ai-agent-chat-image-wrap">
                                <img
                                  src={srcUrl}
                                  alt={filename}
                                  className="ai-agent-chat-image-preview"
                                  loading="lazy"
                                />
                              </span>
                              <span className="ai-agent-chat-image-footer">
                                <span className="ai-agent-chat-image-name" title={filename}>
                                  {filename}
                                </span>
                                <a
                                  href={downloadHref}
                                  download={filename}
                                  className="ai-agent-chat-image-download"
                                  title={`Download ${filename}`}
                                >
                                  <Download size={13} />
                                  <span>Download</span>
                                </a>
                              </span>
                            </span>
                          );
                        },
                      }}
                    >
                      {normalizeMessageContent(message.content, storedCampaign.id, campaignArtifacts)}
                    </ReactMarkdown>
                  </div>
                </div>
                <time className="ai-agent-message-time">{new Date(message.createdAt).toLocaleString()}</time>
                {message.sendState === "failed" && <div className="ai-agent-message-failure" role="alert"><span>Couldn’t send this message. {message.sendError}</span><button type="button" onClick={() => retryMessage(message)} disabled={sending}>Retry</button></div>}
              </div>
            </article>)}
            {isMasterAgent && taskToast && <button type="button" className="ai-agent-chat-task-toast" onClick={() => { setTaskToast(null); setTab("tasks"); }} aria-label={`${taskToast.completedCount} of ${taskToast.total} new team tasks completed. Open task details.`}>
              <i aria-hidden="true" />
              <span className="ai-agent-chat-task-toast-copy"><small>{taskToast.task.status === "failed" ? "Team needs attention on" : taskToast.task.status === "blocked" ? "Waiting on another task" : taskToast.completedCount === taskToast.total ? "Team completed" : "Team is working on"}</small><strong>{taskToast.task.title}</strong></span>
              <small className="ai-agent-chat-task-toast-count">{taskToast.completedCount}/{taskToast.total} done</small>
              <ArrowRight size={14} aria-hidden="true" />
            </button>}
            {sending && pendingAgentId === activeAgent?.id && activeAgent && <article className="ai-agent-message is-agent ai-agent-typing" role="status" aria-label={`${activeAgent.name} is thinking`}>
              <AgentAvatar agent={activeAgent} />
              <div className="ai-agent-typing-body"><span className="ai-agent-typing-label">{activeAgent.name} is thinking</span><span className="ai-agent-typing-dots" aria-hidden="true"><i /><i /><i /></span></div>
            </article>}
          </div>
          <div className="ai-agent-chat-composer-wrap">
            {isMasterAgent && (
              <CompactMasterComputerBar
                campaignId={storedCampaign.id}
                onOpenComputerTab={(specId) => {
                  selectAgent(specId);
                  setTab("computer");
                }}
              />
            )}
            {chatError && <p className="ai-agent-chat-error" role="alert">{chatError}</p>}
            <form className="ai-agent-chat-composer" onSubmit={sendMessage}>
              <textarea ref={composerRef} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Message ${activeAgent?.role ?? "agent"}…`} aria-label="Message agent" maxLength={8000} rows={1} disabled={!activeAgent || sending} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
              <button type="submit" aria-label={sending ? "Sending message" : "Send message"} disabled={!draft.trim() || sending}><Send size={16} /></button>
            </form>
          </div>
        </>}
        {tab === "tasks" && isMasterAgent && <>
          {taskError && <p className="ai-agent-chat-error" role="alert">{taskError} <button type="button" onClick={() => void refreshTasks(MASTER_AGENT.id)}>Retry</button></p>}
          <div className="ai-agent-task-panel">
            <div className="ai-agent-task-list" aria-label="Master Agent task timeline" ref={taskListRef} onScroll={(event) => setShowTaskScrollTop(event.currentTarget.scrollTop > 180)}>
              <TeamComputersSection
                campaignId={storedCampaign.id}
                onOpenComputerTab={(specId) => {
                  selectAgent(specId);
                  setTab("computer");
                }}
              />
              {conversationLoading
              ? <EmptyPanel icon="tasks" title="Loading tasks" text="Retrieving the Master Agent's saved assignments." />
              : tasks.length === 0
                ? <EmptyPanel icon="tasks" title="No tasks yet" text="Tasks assigned by the Master Agent will appear here as your requests are planned." />
                : <ol className="ai-agent-task-timeline">
                  {tasks.map((task, index) => <li key={task.id} className={`ai-agent-task-step is-${task.status}`}>
                    <span className="ai-agent-task-timeline-marker" aria-hidden="true"><TaskTimelineIcon status={task.status} /><small>{index + 1}</small></span>
                    <article className="ai-agent-task-card">
                      <div className="ai-agent-task-card-heading"><span className={`ai-agent-task-status is-${task.status}`}>{task.status}</span><time>{new Date(task.createdAt).toLocaleString()}</time></div>
                      <strong>{task.title}</strong>
                      <small>Task #{task.id} · Scheduled {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: task.timeZone ?? "UTC" }).format(new Date(task.scheduledAt ?? task.createdAt))} ({task.timeZone ?? "UTC"})</small>
                      {task.repeatRule && <small>Repeats {task.repeatRule.frequency}{task.repeatRule.interval > 1 ? ` every ${task.repeatRule.interval}` : ""} · next {task.nextRunAt ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: task.timeZone ?? "UTC" }).format(new Date(task.nextRunAt)) : "after successful run"}</small>}
                      <small>Assigned to {agents.find((agent) => agent.id === task.assignedAgentId)?.role ?? task.assignedAgentId}</small>
                      {task.dependencies.length > 0 && <small className="ai-agent-task-dependencies">After {task.dependencies.map((id) => tasks.find((candidate) => candidate.id === id)?.title ?? `task #${id}`).join(", ")}</small>}
                      <details><summary>Task instructions</summary><p>{task.instructions}</p></details>
                      {task.response && (
                        <div className="ai-agent-task-response-markdown">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {task.response}
                          </ReactMarkdown>
                        </div>
                      )}
                      {task.error && <p className="ai-agent-task-error" role="alert">{formatTaskErrorMessage(task.error)}</p>}
                    </article>
                  </li>)}
                </ol>}
            </div>
            {showTaskScrollTop && <button type="button" className="ai-agent-task-scroll-top" aria-label="Scroll to top of task timeline" title="Back to top" onClick={() => taskListRef.current?.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}><ArrowUp size={15} /><span>Back to top</span></button>}
          </div>
        </>}
        {tab === "computer" && isEligibleForComputer && (
          <AgentComputerPanel
            agentId={activeAgent.id}
            agentRole={activeAgent.role}
            campaignId={storedCampaign.id}
            campaignName={storedCampaign.name}
          />
        )}
        {tab === "history" && (conversationLoading
          ? <EmptyPanel icon="history" title="Loading history" text="Retrieving this agent's saved conversation." />
          : messages.length === 0
            ? <EmptyPanel icon="history" title="No agent history yet" text="Messages with this agent in the selected campaign will appear here." />
          : <div className="ai-agent-history-list">{messages.map((message) => <article key={message.id} className="ai-agent-history-item"><span>{message.role === "master" ? "Master Agent" : message.role === "assistant" ? activeAgent?.role : (profileName || user.profile?.name || "You")}</span><p>{message.content}</p><time>{new Date(message.createdAt).toLocaleString()}</time></article>)}</div>)}
        {tab === "settings" && <EmptyPanel icon="settings" title="Agent settings" text="There are no per-agent settings to change. Responses use the selected agent's role and the active campaign's saved context." />}
      </div>

      {showEndCampaignModal && (
        <div
          className="soto-confirm-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="end-campaign-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !endingCampaign) {
              setShowEndCampaignModal(false);
            }
          }}
        >
          <div className="soto-confirm-modal">
            <div className="soto-confirm-modal-header">
              <AlertTriangle size={20} />
              <h3 id="end-campaign-title">End Campaign: {storedCampaign.name}</h3>
            </div>
            <div className="soto-confirm-modal-body">
              {campaignEnded ? (
                <div style={{ color: "#16a34a", padding: "10px 0" }}>
                  <strong>Campaign safely ended.</strong>
                  <p>All active tasks were fenced and cloud computers were shut down.</p>
                </div>
              ) : (
                <>
                  <p>
                    Are you sure you want to end <strong>{storedCampaign.name}</strong>?
                  </p>
                  <div className="soto-confirm-modal-warning">
                    <strong>Critical Action:</strong> Ending this campaign will permanently stop all active tasks, fence background executions, and shut down all cloud computers allocated to this campaign.
                  </div>
                  {endCampaignError && (
                    <div style={{ color: "#dc2626", marginTop: 12, fontSize: 12 }}>
                      Error: {endCampaignError}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="soto-confirm-modal-footer">
              {!campaignEnded && (
                <>
                  <button
                    type="button"
                    className="soto-btn-cancel"
                    onClick={() => setShowEndCampaignModal(false)}
                    disabled={endingCampaign}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="soto-btn-danger"
                    onClick={handleConfirmEndCampaign}
                    disabled={endingCampaign}
                  >
                    {endingCampaign ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        <span>Ending Campaign…</span>
                      </>
                    ) : (
                      <>
                        <PowerOff size={13} />
                        <span>Confirm End Campaign</span>
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );

  if (mode === "embedded") return <div className="ai-agent-embedded-workspace">{workspacePanel}</div>;

  return (
    <div className="soto-layout">
      <DashboardSidebar user={user} storedCampaign={storedCampaign} campaigns={campaigns} profileName={profileName} />
      <div className="soto-main-wrapper">
        <FloatingTopbar>
          <div className="soto-topbar-heading">
            <h1 className="soto-page-title">AI Agents</h1>
          <p className="soto-page-subtitle">Coordinate your team and follow every assignment.</p>
          </div>
          <div className="soto-topbar-actions ai-agents-search">
            <label className="soto-search-box" aria-label="Search agents">
              <Search size={14} className="soto-search-icon" />
              <input className="soto-search-field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agents..." />
            </label>
          </div>
        </FloatingTopbar>

        <main className="soto-canvas ai-agents-canvas">
          <div className="ai-agents-layout">
            <section className="ai-agent-workspace" aria-label="Agent workspace">
              <p className="ai-agent-selector-caption">Send your request to the Master Agent. It plans the work and coordinates your team.</p>
              <div className="ai-agent-selector" aria-label="Choose an agent">
                <AgentActivityPopover
                  agentId={MASTER_AGENT.id}
                  agentRole={MASTER_AGENT.role}
                  agentName={MASTER_AGENT.name}
                  activity={agentActivities[MASTER_AGENT.id]}
                  onSelect={selectAgent}
                  placement="bottom"
                >
                  <button type="button" className={`ai-agent-card ai-agent-master-card ${activeAgent?.id === MASTER_AGENT.id ? "is-selected" : ""}`} aria-pressed={activeAgent?.id === MASTER_AGENT.id} onClick={() => selectAgent(MASTER_AGENT.id)}>
                    <span className="ai-agent-avatar-fallback ai-agent-master-avatar"><WandSparkles size={22} /></span>
                    <span className="ai-agent-card-copy">
                      <strong>Master Agent <WandSparkles size={13} aria-hidden="true" /></strong>
                      <small>Plans your requests, assigns work, and brings the team’s results together.</small>
                      <small className={`ai-agent-status is-${agentActivities[MASTER_AGENT.id]?.executionStatus ?? "ready"}`}>
                        <i aria-hidden="true" />
                        {formatExecutionStatus(agentActivities[MASTER_AGENT.id]?.executionStatus ?? "ready").label}
                      </small>
                    </span>
                  </button>
                </AgentActivityPopover>
                <div className="ai-agent-specialists" aria-label="Specialist agents">
                  {filteredAgents.map((agent) => {
                    const activity = agentActivities[agent.id];
                    const statusInfo = formatExecutionStatus(activity?.executionStatus ?? "ready");
                    return (
                      <AgentActivityPopover
                        key={agent.id}
                        agentId={agent.id}
                        agentRole={agent.role}
                        agentName={agent.name}
                        activity={activity}
                        onSelect={selectAgent}
                        placement="bottom"
                      >
                        <button type="button" className={`ai-agent-card ${activeAgent?.id === agent.id ? "is-selected" : ""}`} aria-label={`${agent.role}, ${statusInfo.label}`} aria-pressed={activeAgent?.id === agent.id} onClick={() => selectAgent(agent.id)}>
                          <AgentAvatar agent={agent} />
                          <span className="ai-agent-card-copy">
                            <strong>{agent.role}</strong>
                            <small className={`ai-agent-status ${statusInfo.cssClass}`}>
                              <i aria-hidden="true" />
                              {statusInfo.label}
                            </small>
                          </span>
                        </button>
                      </AgentActivityPopover>
                    );
                  })}
                  {filteredAgents.length === 0 && <p className="ai-agent-no-results">No agents match “{query}”.</p>}
                </div>
              </div>

              {workspacePanel}
            </section>

            <aside className={`ai-agent-office-column ${office?.sceneType === "modern" ? "is-modern" : ""} ${office?.sceneType === "wooden" ? "is-wooden" : ""}`} aria-label="Campaign office">
              <div className="ai-agent-office-heading"><div><span>CAMPAIGN OFFICE</span><h2>{office?.title ?? "Office preview"}</h2></div><span className="ai-agent-office-campaign">{storedCampaign.name}</span></div>
              <AiAgentOffice
                sceneType={office?.sceneType ?? null}
                selectedAgentId={activeAgent?.id}
                onAgentSelect={selectAgent}
                fillAvailableSpace
                activities={agentActivities}
              />
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}

function AgentAvatar({ agent, large = false }: { agent: OfficeAgent; large?: boolean }) {
  if (agent.id === MASTER_AGENT.id) return <span className={`ai-agent-avatar-fallback ai-agent-master-avatar ${large ? "is-large" : ""}`}><WandSparkles size={large ? 20 : 18} /></span>;
  return agent.avatar
    ? <img className={`ai-agent-avatar ${large ? "is-large" : ""}`} src={agent.avatar} alt="" />
    : <span className={`ai-agent-avatar-fallback ${large ? "is-large" : ""}`}><Bot size={large ? 19 : 16} /></span>;
}

function TaskTimelineIcon({ status }: { status: string }) {
  if (status === "completed") return <Check size={12} />;
  if (status === "running") return <LoaderCircle size={12} />;
  if (status === "failed") return <CircleAlert size={12} />;
  return <CircleDashed size={12} />;
}

function EmptyPanel({ icon, title, text }: { icon: "chat" | "history" | "settings" | "tasks"; title: string; text: string }) {
  const Icon = icon === "chat" ? Sparkles : icon === "history" ? History : icon === "tasks" ? ClipboardList : Settings;
  return <div className="ai-agent-empty-state"><span><Icon size={20} /></span><strong>{title}</strong><p>{text}</p></div>;
}
