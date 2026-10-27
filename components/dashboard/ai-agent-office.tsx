"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart3, CalendarDays, LoaderCircle, PenLine, Search, Sparkles } from "lucide-react";

export type OfficeSceneType = "wooden" | "modern";

type OfficeSeat = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  zIndex: number;
  character: {
    name: string;
    role?: string;
    roleIcon?: "search" | "pen" | "calendar" | "chart";
    width: number;
    height: number;
    frames: string[];
  };
};

type OfficeScene = {
  width: number;
  height: number;
  background: string;
  seats: OfficeSeat[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOfficeScene(value: unknown): value is OfficeScene {
  if (!isRecord(value) || !Array.isArray(value.seats)) return false;
  return typeof value.width === "number" && Number.isFinite(value.width) && value.width > 0 &&
    typeof value.height === "number" && Number.isFinite(value.height) && value.height > 0 &&
    typeof value.background === "string" && value.background.startsWith("data:image/") &&
    value.seats.every((seat) => {
      if (!isRecord(seat) || !isRecord(seat.character)) return false;
      return typeof seat.id === "string" && typeof seat.label === "string" &&
        typeof seat.x === "number" && Number.isFinite(seat.x) &&
        typeof seat.y === "number" && Number.isFinite(seat.y) &&
        typeof seat.width === "number" && Number.isFinite(seat.width) && seat.width > 0 &&
        typeof seat.zIndex === "number" && Number.isFinite(seat.zIndex) &&
        typeof seat.character.name === "string" &&
        (seat.character.role === undefined || typeof seat.character.role === "string") &&
        (seat.character.roleIcon === undefined || ["search", "pen", "calendar", "chart"].includes(String(seat.character.roleIcon))) &&
        typeof seat.character.width === "number" && Number.isFinite(seat.character.width) && seat.character.width > 0 &&
        typeof seat.character.height === "number" && Number.isFinite(seat.character.height) && seat.character.height > 0 &&
        Array.isArray(seat.character.frames) && seat.character.frames.length > 0 &&
        seat.character.frames.every((frame) => typeof frame === "string" && frame.startsWith("data:image/"));
    });
}

export function AiAgentOffice({ sceneType, selectedAgentId, onAgentSelect, fillAvailableSpace = false }: { sceneType: OfficeSceneType | null; selectedAgentId?: string | null; onAgentSelect?: (agentId: string) => void; fillAvailableSpace?: boolean }) {
  const [scene, setScene] = useState<OfficeScene | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [panelSize, setPanelSize] = useState({ width: 0, height: 0 });
  const scenePanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sceneType) {
      setScene(null);
      setStatus("error");
      return;
    }

    const controller = new AbortController();
    setScene(null);
    setStatus("loading");

    fetch(`/api/office-scene/${sceneType}?schema=2`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Scene endpoint returned ${response.status}`);
        const payload: unknown = await response.json();
        if (!isOfficeScene(payload)) throw new Error("Scene payload did not match the expected structure");
        return payload;
      })
      .then((loadedScene) => {
        if (controller.signal.aborted) return;
        setScene(loadedScene);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error("[office-scene] Failed to load the selected office", {
          sceneType,
          reason: error instanceof Error ? error.message : "UnknownError",
        });
        setStatus("error");
      });

    return () => controller.abort();
  }, [sceneType]);

  useEffect(() => {
    if (!(sceneType === "modern" || fillAvailableSpace) || status !== "ready" || !scene) return;
    const panel = scenePanelRef.current;
    if (!panel) return;

    const measure = () => {
      const nextSize = { width: panel.clientWidth, height: panel.clientHeight };
      setPanelSize((current) => current.width === nextSize.width && current.height === nextSize.height ? current : nextSize);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [sceneType, fillAvailableSpace, status, scene]);

  const useCover = sceneType === "modern" || fillAvailableSpace;
  const coverScale = scene && useCover && panelSize.width > 0 && panelSize.height > 0
    ? Math.max(panelSize.width / scene.width, panelSize.height / scene.height)
    : 1;
  const coverOffsetX = scene && useCover && panelSize.width > 0
    ? (panelSize.width - scene.width * coverScale) / 2
    : 0;
  const coverOffsetY = scene && useCover && panelSize.height > 0
    ? (panelSize.height - scene.height * coverScale) / 2
    : 0;

  const officeTitle = sceneType === "wooden"
    ? "Wooden Office"
    : sceneType === "modern"
      ? "Modern Office"
      : "AI Agent Office";

  return (
    <section className="soto-agent-office-card" aria-label={`${officeTitle} AI Agent Office`}>
      {status === "loading" && (
        <div className={`soto-agent-office-state ${sceneType === "modern" ? "is-modern" : ""}`} role="status">
          <LoaderCircle size={18} className="soto-agent-office-spinner" />
          <span>Loading your office…</span>
        </div>
      )}
      {status === "error" && (
        <div className={`soto-agent-office-state ${sceneType === "modern" ? "is-modern" : ""}`} role="status">
          <span>{sceneType ? "The office scene is unavailable right now." : "This campaign has no valid saved office selection."}</span>
        </div>
      )}
      {status === "ready" && scene && (
        <div
          className={`soto-agent-office-scene ${sceneType === "modern" ? "is-modern" : ""} ${fillAvailableSpace ? "is-cover" : ""}`}
          ref={useCover ? scenePanelRef : undefined}
          role="group"
          aria-label={`${officeTitle} with ${scene.seats.length} AI agents at their desks`}
          style={sceneType === "modern" ? undefined : { aspectRatio: `${scene.width} / ${scene.height}` }}
        >
          <div
            className={`soto-agent-office-scene-canvas ${sceneType === "modern" ? "is-modern" : ""} ${fillAvailableSpace ? "is-cover" : ""}`}
            style={{
              aspectRatio: `${scene.width} / ${scene.height}`,
              backgroundImage: `url(${scene.background})`,
            }}
          >
            {scene.seats.map((seat) => (
              <OfficeCharacter
                key={seat.id}
                seat={seat}
                scene={scene}
                coverScale={coverScale}
                coverOffsetX={coverOffsetX}
                coverOffsetY={coverOffsetY}
                panelSize={panelSize}
                useCover={useCover}
                selected={selectedAgentId === seat.id}
                onSelect={onAgentSelect}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function OfficeCharacter({
  seat,
  scene,
  coverScale,
  coverOffsetX,
  coverOffsetY,
  panelSize,
  useCover,
  selected,
  onSelect,
}: {
  seat: OfficeSeat;
  scene: OfficeScene;
  coverScale: number;
  coverOffsetX: number;
  coverOffsetY: number;
  panelSize: { width: number; height: number };
  useCover: boolean;
  selected: boolean;
  onSelect?: (agentId: string) => void;
}) {
  const frames = seat.character.frames;
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    setFrameIndex(0);
    if (frames.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // The scene bundle supplies the typing frames but no cadence, so use a modest shared playback rate.
    const timer = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % frames.length);
    }, 150);
    return () => window.clearInterval(timer);
  }, [frames]);

  const frame = frames[frameIndex] ?? frames[0];
  if (!frame) return null;
  const RoleIcon = {
    search: Search,
    pen: PenLine,
    calendar: CalendarDays,
    chart: BarChart3,
    sparkles: Sparkles,
  }[seat.character.roleIcon ?? "sparkles"];
  const role = seat.character.role?.trim() || seat.character.name;
  const frameWidth = useCover && panelSize.width > 0 ? panelSize.width : scene.width;
  const frameHeight = useCover && panelSize.height > 0 ? panelSize.height : scene.height;
  const x = ((seat.x * coverScale + (useCover ? coverOffsetX : 0)) / frameWidth) * 100;
  const centerX = (((seat.x + seat.width / 2) * coverScale + (useCover ? coverOffsetX : 0)) / frameWidth) * 100;
  const y = ((seat.y * coverScale + (useCover ? coverOffsetY : 0)) / frameHeight) * 100;
  const characterWidth = ((seat.width * coverScale) / frameWidth) * 100;
  const horizontalPlacement = centerX < 18 ? "is-left-aligned" : centerX > 82 ? "is-right-aligned" : "";
  const verticalPlacement = y < 17 ? "is-below" : "is-above";
  const AgentElement = onSelect ? "button" : "span";

  return (
    <AgentElement
      {...(onSelect ? { type: "button" as const } : { role: "group", tabIndex: 0 })}
      className={`soto-agent-office-agent ${verticalPlacement} ${horizontalPlacement} ${selected ? "is-selected" : ""}`}
      aria-label={onSelect ? `Select ${role}` : role}
      aria-pressed={onSelect ? selected : undefined}
      onClick={onSelect ? () => onSelect(seat.id) : undefined}
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: `${characterWidth}%`,
        aspectRatio: `${seat.character.width} / ${seat.character.height}`,
        zIndex: seat.zIndex,
      }}
    >
      <img className="soto-agent-office-character" src={frame} alt="" aria-hidden="true" draggable={false} />
      <span className="soto-agent-office-agent-popover">
        <span className="soto-agent-office-agent-icon" aria-hidden="true"><RoleIcon size={12} strokeWidth={2.2} /></span>
        <span className="soto-agent-office-agent-label">
          <strong>{role}</strong>
        </span>
      </span>
    </AgentElement>
  );
}
