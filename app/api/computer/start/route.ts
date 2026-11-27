import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/insforge/server";
import { startComputerService } from "@/lib/computer-service";
import {
  CampaignEndedAbortError,
  IneligibleAgentComputerError,
} from "@/lib/computer-types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { agentId?: string; campaignId?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { agentId, campaignId } = body;
  if (!agentId || typeof agentId !== "string") {
    return NextResponse.json(
      { error: "agentId string is required in request body." },
      { status: 400 },
    );
  }

  try {
    const result = await startComputerService(
      user.id,
      agentId,
      campaignId ? Number(campaignId) : null,
    );
    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof IneligibleAgentComputerError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof CampaignEndedAbortError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "Internal Server Error";
    if (message.includes("Campaign not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

