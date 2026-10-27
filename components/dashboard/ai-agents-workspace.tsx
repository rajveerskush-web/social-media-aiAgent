"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowUp, Bot, Check, CircleAlert, CircleDashed, ClipboardList, History, LoaderCircle, MessageCircle, Search, Send, Settings, Sparkles, WandSparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { AiAgentOffice, type OfficeSceneType } from "@/components/dashboard/ai-agent-office";
import { FloatingTopbar } from "@/components/dashboard/floating-topbar";
import type { OfficeAgent } from "@/lib/office-agents";

type Tab = "chat" | "tasks" | "history" | "settings";
type ChatMessage = { id: number | string; role: string; content: string; createdAt: string; requestKey?: string; animate?: boolean; sendState?: "pending" | "failed"; sendError?: string };
type WorkspaceTask = { id: number; title: string; instructions: string; dependencies: number[]; assignedAgentId: string; status: string; response?: string | null; error?: string | null; createdAt: string };
const MASTER_AGENT: OfficeAgent = { id: "master-agent", name: "Master Agent", role: "Master Agent", avatar: null };

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
  const [conversationLoading, setConversationLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [chatError, setChatError] = useState("");
  const [taskError, setTaskError] = useState("");
  const [showTaskScrollTop, setShowTaskScrollTop] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const taskListRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const autoScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversationLoadControllerRef = useRef<AbortController | null>(null);
  const autoScrollingRef = useRef(false);
  const initialPositionRef = useRef(true);
  const sendingRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const effectiveSelectedId = mode === "embedded" ? selectedAgentId : selectedId;
  const activeAgent = effectiveSelectedId === MASTER_AGENT.id ? MASTER_AGENT : agents.find((agent) => agent.id === effectiveSelectedId) ?? agents[0];
  const isMasterAgent = activeAgent?.id === MASTER_AGENT.id;
  const workspaceTabs = isMasterAgent
    ? ([ ["chat", "Chat", MessageCircle], ["tasks", "Tasks", ClipboardList], ["settings", "Settings", Settings] ] as const)
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
    setChatError("");
    setTaskError("");
    setConversationLoading(true);
    fetch(`/api/agent-chat?agentId=${encodeURIComponent(activeAgent.id)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load this conversation.");
        setMessages(payload.messages ?? []);
        setTasks(payload.tasks ?? []);
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
  }, [messages, tab, sending, conversationLoading]);

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
    setSelectedId(id);
    setTab("chat");
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
      setTasks(payload.tasks ?? []);
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

  const workspacePanel = (
    <section className="ai-agent-detail-card" aria-label={activeAgent ? `${activeAgent.role} workspace` : "Agent workspace"}>
      <header className="ai-agent-detail-header">
        {activeAgent ? <AgentAvatar agent={activeAgent} large /> : <span className="ai-agent-avatar-fallback"><Bot size={18} /></span>}
        <div className="ai-agent-detail-identity">
          <strong>{activeAgent?.role ?? "Agents unavailable"}</strong>
          <span>{isMasterAgent ? "Plans your requests, assigns tasks, and coordinates your team." : "Ready for questions and Master Agent assignments."}</span>
          {activeAgent && <small className="ai-agent-header-status"><i aria-hidden="true" />Active</small>}
        </div>
        <button type="button" className="ai-agent-header-settings" onClick={() => setTab("settings")} aria-label="Open agent settings" title="Settings"><Settings size={15} /><span>Settings</span></button>
        <span className="ai-agent-campaign-label">{storedCampaign.name}</span>
      </header>
      <div className="ai-agent-tabs" role="tablist" aria-label="Agent workspace sections">
        {workspaceTabs.map(([id, label, Icon]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`ai-agent-tab ${tab === id ? "is-active" : ""}`} onClick={() => setTab(id)}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>
      <div className="ai-agent-tab-panel" role="tabpanel">
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
                <div className="ai-agent-message-content"><div className="ai-agent-message-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div></div>
                <time className="ai-agent-message-time">{new Date(message.createdAt).toLocaleString()}</time>
                {message.sendState === "failed" && <div className="ai-agent-message-failure" role="alert"><span>Couldn’t send this message. {message.sendError}</span><button type="button" onClick={() => retryMessage(message)} disabled={sending}>Retry</button></div>}
              </div>
            </article>)}
            {sending && pendingAgentId === activeAgent?.id && activeAgent && <article className="ai-agent-message is-agent ai-agent-typing" role="status" aria-label={`${activeAgent.name} is thinking`}>
              <AgentAvatar agent={activeAgent} />
              <div className="ai-agent-typing-body"><span className="ai-agent-typing-label">{activeAgent.name} is thinking</span><span className="ai-agent-typing-dots" aria-hidden="true"><i /><i /><i /></span></div>
            </article>}
          </div>
          <div className="ai-agent-chat-composer-wrap">
            {chatError && <p className="ai-agent-chat-error" role="alert">{chatError}</p>}
            <form className="ai-agent-chat-composer" onSubmit={sendMessage}>
              <textarea ref={composerRef} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Message ${activeAgent?.role ?? "agent"}…`} aria-label="Message agent" maxLength={8000} rows={1} disabled={!activeAgent || sending} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
              <button type="submit" aria-label={sending ? "Sending message" : "Send message"} disabled={!draft.trim() || sending}><Send size={16} /></button>
            </form>
          </div>
        </>}
        {tab === "tasks" && isMasterAgent && <>
          {taskError && <p className="ai-agent-chat-error" role="alert">{taskError} <button type="button" onClick={() => void refreshTasks(MASTER_AGENT.id)}>Retry</button></p>}
          {conversationLoading
          ? <EmptyPanel icon="tasks" title="Loading tasks" text="Retrieving the Master Agent's saved assignments." />
          : tasks.length === 0
            ? <EmptyPanel icon="tasks" title="No tasks yet" text="Tasks assigned by the Master Agent will appear here as your requests are planned." />
            : <div className="ai-agent-task-panel">
              <div className="ai-agent-task-list" aria-label="Master Agent task timeline" ref={taskListRef} onScroll={(event) => setShowTaskScrollTop(event.currentTarget.scrollTop > 180)}>
                <ol className="ai-agent-task-timeline">
                  {tasks.map((task, index) => <li key={task.id} className={`ai-agent-task-step is-${task.status}`}>
                    <span className="ai-agent-task-timeline-marker" aria-hidden="true"><TaskTimelineIcon status={task.status} /><small>{index + 1}</small></span>
                    <article className="ai-agent-task-card">
                      <div className="ai-agent-task-card-heading"><span className={`ai-agent-task-status is-${task.status}`}>{task.status}</span><time>{new Date(task.createdAt).toLocaleString()}</time></div>
                      <strong>{task.title}</strong>
                      <small>Assigned to {agents.find((agent) => agent.id === task.assignedAgentId)?.role ?? task.assignedAgentId}</small>
                      {task.dependencies.length > 0 && <small className="ai-agent-task-dependencies">After {task.dependencies.map((id) => tasks.find((candidate) => candidate.id === id)?.title ?? `task #${id}`).join(", ")}</small>}
                      <details><summary>Task instructions</summary><p>{task.instructions}</p></details>
                      {task.response && <p>{task.response}</p>}
                      {task.error && <p className="ai-agent-task-error" role="alert">{task.error}</p>}
                    </article>
                  </li>)}
                </ol>
              </div>
              {showTaskScrollTop && <button type="button" className="ai-agent-task-scroll-top" aria-label="Scroll to top of task timeline" title="Back to top" onClick={() => taskListRef.current?.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}><ArrowUp size={15} /><span>Back to top</span></button>}
            </div>}
        </>}
        {tab === "history" && (conversationLoading
          ? <EmptyPanel icon="history" title="Loading history" text="Retrieving this agent's saved conversation." />
          : messages.length === 0
            ? <EmptyPanel icon="history" title="No agent history yet" text="Messages with this agent in the selected campaign will appear here." />
          : <div className="ai-agent-history-list">{messages.map((message) => <article key={message.id} className="ai-agent-history-item"><span>{message.role === "master" ? "Master Agent" : message.role === "assistant" ? activeAgent?.role : (profileName || user.profile?.name || "You")}</span><p>{message.content}</p><time>{new Date(message.createdAt).toLocaleString()}</time></article>)}</div>)}
        {tab === "settings" && <EmptyPanel icon="settings" title="Agent settings" text="There are no per-agent settings to change. Responses use the selected agent's role and the active campaign's saved context." />}
      </div>
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
                <button type="button" className={`ai-agent-card ai-agent-master-card ${activeAgent?.id === MASTER_AGENT.id ? "is-selected" : ""}`} aria-pressed={activeAgent?.id === MASTER_AGENT.id} onClick={() => selectAgent(MASTER_AGENT.id)}>
                  <span className="ai-agent-avatar-fallback ai-agent-master-avatar"><WandSparkles size={22} /></span>
                  <span className="ai-agent-card-copy"><strong>Master Agent <WandSparkles size={13} aria-hidden="true" /></strong><small>Plans your requests, assigns work, and brings the team’s results together.</small><small className="ai-agent-status"><i aria-hidden="true" />Active</small></span>
                </button>
                <div className="ai-agent-specialists" aria-label="Specialist agents">
                  {filteredAgents.map((agent) => (
                    <button key={agent.id} type="button" className={`ai-agent-card ${activeAgent?.id === agent.id ? "is-selected" : ""}`} aria-label={`${agent.role}, Active`} aria-pressed={activeAgent?.id === agent.id} onClick={() => selectAgent(agent.id)}>
                      <AgentAvatar agent={agent} />
                      <span className="ai-agent-card-copy"><strong>{agent.role}</strong><small className="ai-agent-status"><i aria-hidden="true" />Active</small></span>
                    </button>
                  ))}
                  {filteredAgents.length === 0 && <p className="ai-agent-no-results">No agents match “{query}”.</p>}
                </div>
              </div>

              {workspacePanel}
            </section>

            <aside className={`ai-agent-office-column ${office?.sceneType === "modern" ? "is-modern" : ""} ${office?.sceneType === "wooden" ? "is-wooden" : ""}`} aria-label="Campaign office">
              <div className="ai-agent-office-heading"><div><span>CAMPAIGN OFFICE</span><h2>{office?.title ?? "Office preview"}</h2></div><span className="ai-agent-office-campaign">{storedCampaign.name}</span></div>
              <AiAgentOffice sceneType={office?.sceneType ?? null} selectedAgentId={activeAgent?.id} onAgentSelect={selectAgent} fillAvailableSpace />
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
