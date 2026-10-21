import "server-only";
import { cookies } from "next/headers";

export const CURRENT_CAMPAIGN_COOKIE = "soto_campaign_id";

export async function saveCurrentCampaignSelection(campaignId: number) {
  const cookieStore = await cookies();
  cookieStore.set(CURRENT_CAMPAIGN_COOKIE, String(campaignId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
