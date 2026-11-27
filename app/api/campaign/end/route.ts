import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/insforge/server";
import { endCampaignService } from "@/lib/computer-service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { campaignId?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { campaignId } = body;
  if (!campaignId || !Number.isInteger(Number(campaignId))) {
    return NextResponse.json(
      { error: "campaignId integer is required in request body." },
      { status: 400 },
    );
  }

  try {
    const result = await endCampaignService(user.id, Number(campaignId));
    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    if (message.includes("Campaign not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

