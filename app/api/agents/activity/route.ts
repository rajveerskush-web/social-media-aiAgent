import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getCampaignForAuthUser } from "@/lib/insforge/server";
import { getCampaignAgentsActivity } from "@/lib/agent-activity";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const campaignIdParam = searchParams.get("campaignId");

    let campaignId: number;
    if (campaignIdParam) {
      campaignId = Number(campaignIdParam);
      if (Number.isNaN(campaignId)) {
        return NextResponse.json({ error: "Invalid campaignId" }, { status: 400 });
      }
    } else {
      const activeCampaign = await getCampaignForAuthUser(user.id);
      if (!activeCampaign) {
        return NextResponse.json({ error: "No campaign found for user" }, { status: 404 });
      }
      campaignId = activeCampaign.id;
    }

    const result = await getCampaignAgentsActivity(user.id, campaignId);
    return NextResponse.json(result, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    if (message.includes("not found") || message.includes("access denied")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

