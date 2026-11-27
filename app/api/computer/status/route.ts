import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/insforge/server";
import { getComputerStatusService } from "@/lib/computer-service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agentId");
  const campaignIdParam = searchParams.get("campaignId");
  const campaignId = campaignIdParam ? Number(campaignIdParam) : null;

  if (!agentId) {
    return NextResponse.json(
      { error: "agentId query parameter is required." },
      { status: 400 },
    );
  }

  try {
    const result = await getComputerStatusService(user.id, agentId, campaignId);
    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    if (message.includes("Campaign not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

