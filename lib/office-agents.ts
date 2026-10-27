import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { OfficeSceneType } from "@/components/dashboard/ai-agent-office";

const sceneFiles: Record<OfficeSceneType, string> = {
  wooden: "wooden-office.json",
  modern: "mordern-office.json",
};

export type OfficeAgent = {
  id: string;
  name: string;
  role: string;
  avatar: string | null;
};

export async function getOfficeAgents(sceneType: OfficeSceneType | null): Promise<OfficeAgent[]> {
  if (!sceneType) return [];
  try {
    const file = path.join(process.cwd(), "office-studio", sceneFiles[sceneType]);
    const source = JSON.parse(await readFile(file, "utf8"));
    if (!Array.isArray(source?.seats)) return [];
    return source.seats.flatMap((seat: any) => {
      const character = seat?.character;
      if (typeof seat?.id !== "string" || typeof character?.name !== "string") return [];
      const avatar = [character.thumbnail, character.sprite].find((value) => typeof value === "string" && value.startsWith("data:image/"));
      return [{
        id: seat.id,
        name: character.name,
        role: typeof character.role === "string" ? character.role : character.name,
        avatar: typeof avatar === "string" ? avatar : null,
      }];
    });
  } catch {
    return [];
  }
}
