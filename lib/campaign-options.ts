export const campaignIcons = [
  { key: "sparkles", label: "Sparkles" },
  { key: "rocket", label: "Rocket" },
  { key: "target", label: "Target" },
  { key: "brain", label: "Brain" },
] as const;

export const officeOptions = [
  {
    id: "Screenshot 2026-10-18 214546.png",
    title: "The Workshop",
    description: "A warm, creative studio for thoughtful work and fresh ideas.",
    image: "/offices/Screenshot%202026-10-18%20214546.png",
    tag: "CREATIVE STUDIO",
  },
  {
    id: "Screenshot 2026-10-18 214554.png",
    title: "The Command Center",
    description: "A vivid, high-energy space built for ambitious teams.",
    image: "/offices/Screenshot%202026-10-18%20214554.png",
    tag: "MISSION CONTROL",
  },
] as const;

export type CampaignIconKey = (typeof campaignIcons)[number]["key"];
export type OfficeImageKey = (typeof officeOptions)[number]["id"];
export type OfficeOption = {
  id: string;
  title: string;
  description: string;
  image: string;
  tag: string;
};
