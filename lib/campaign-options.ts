export const campaignIcons = [
  { key: "sparkles", label: "Sparkles" },
  { key: "rocket", label: "Rocket" },
  { key: "target", label: "Target" },
  { key: "brain", label: "Brain" },
] as const;

export const officeOptions = [
  {
    id: "modern-office",
    title: "Modern Office",
    description: "A modern, high-energy workspace designed for ambitious teams.",
    image: "/offices/mordern-office.png",
    tag: "MISSION CONTROL",
    sceneType: "modern",
  },
  {
    id: "wooden-office",
    title: "Wooden Office",
    description: "A warm, creative studio for thoughtful work and fresh ideas.",
    image: "/offices/wooden-office.png",
    tag: "CREATIVE STUDIO",
    sceneType: "wooden",
  },
] as const;

export type CampaignIconKey = (typeof campaignIcons)[number]["key"];
export type OfficeImageKey = (typeof officeOptions)[number]["id"];
export type OfficeOption = (typeof officeOptions)[number];

const legacyOfficeIds: Record<string, OfficeImageKey> = {
  "Screenshot 2026-10-18 214546.png": "wooden-office",
  "Screenshot 2026-10-18 214554.png": "modern-office",
};

/** Resolve current IDs and legacy persisted filenames without guessing an office. */
export function getOfficeOptionByStoredId(storedId: string | null | undefined) {
  if (!storedId) return undefined;
  const stableId = legacyOfficeIds[storedId] ?? storedId;
  return officeOptions.find((office) => office.id === stableId);
}
