import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/insforge/server";

export const runtime = "nodejs";

const sceneFiles = {
  wooden: "wooden-office.json",
  // The repository's existing filename contains this spelling.
  modern: "mordern-office.json",
} as const;

type SceneType = keyof typeof sceneFiles;

function isSceneType(value: string): value is SceneType {
  return value === "wooden" || value === "modern";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ type: string }> },
) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { type } = await params;
  if (!isSceneType(type)) {
    return NextResponse.json({ error: "Unknown office scene" }, { status: 404 });
  }

  try {
    const filePath = path.join(process.cwd(), "office-studio", sceneFiles[type]);
    const source = JSON.parse(await readFile(filePath, "utf8"));
    const office = source?.office;
    const rawSeats = source?.seats;

    if (
      !Number.isFinite(office?.width) || office.width <= 0 ||
      !Number.isFinite(office?.height) || office.height <= 0 ||
      typeof office?.background !== "string" ||
      !office.background.startsWith("data:image/") ||
      !Array.isArray(rawSeats)
    ) {
      console.error("[office-scene] Invalid scene configuration", { sceneType: type });
      return NextResponse.json({ error: "Invalid office scene" }, { status: 503 });
    }

    const seats = rawSeats.flatMap((seat: any) => {
      const character = seat?.character;
      const frames = Array.isArray(character?.animations?.typing)
        ? character.animations.typing.filter((frame: unknown) => typeof frame === "string" && frame.startsWith("data:image/"))
        : [];
      const fallbackFrame = character?.thumbnail ?? character?.sprite;
      const validFrames = frames.length > 0
        ? frames
        : typeof fallbackFrame === "string" && fallbackFrame.startsWith("data:image/")
          ? [fallbackFrame]
          : [];

      if (
        !Number.isFinite(seat?.x) || !Number.isFinite(seat?.y) ||
        !Number.isFinite(seat?.width) || seat.width <= 0 ||
        !Number.isFinite(seat?.zIndex) || validFrames.length === 0 ||
        !Number.isFinite(character?.width) || character.width <= 0 ||
        !Number.isFinite(character?.height) || character.height <= 0
      ) return [];

      return [{
        id: String(seat.id ?? character.id ?? seat.label ?? "agent"),
        label: typeof seat.label === "string" ? seat.label : "AI Agent",
        x: seat.x,
        y: seat.y,
        width: seat.width,
        zIndex: seat.zIndex,
        character: {
          name: typeof character.name === "string" ? character.name : "AI Agent",
          role: typeof character.role === "string" ? character.role : (typeof character.name === "string" ? character.name : "AI Agent"),
          roleIcon: ["search", "pen", "calendar", "chart"].includes(character.roleIcon) ? character.roleIcon : "search",
          width: character.width,
          height: character.height,
          frames: validFrames,
        },
      }];
    });

    return NextResponse.json(
      { width: office.width, height: office.height, background: office.background, seats },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[office-scene] Failed to read or parse scene configuration", {
      sceneType: type,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Office scene unavailable" }, { status: 503 });
  }
}
