import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/insforge/server";
import { downloadArtifactService } from "@/lib/computer-service";
import {
  ArtifactNotFoundError,
  ArtifactUnverifiedError,
  InvalidPathAccessError,
} from "@/lib/computer-types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const artifactIdParam = searchParams.get("artifactId");
  const campaignIdParam = searchParams.get("campaignId");

  if (!artifactIdParam) {
    return NextResponse.json(
      { error: "artifactId query parameter is required." },
      { status: 400 },
    );
  }

  const artifactId = Number(artifactIdParam);
  if (!Number.isInteger(artifactId) || artifactId <= 0) {
    return NextResponse.json({ error: "Invalid artifactId." }, { status: 400 });
  }

  const campaignId = campaignIdParam ? Number(campaignIdParam) : null;

  try {
    const { filename, mimeType, sizeBytes, bytes } =
      await downloadArtifactService(user.id, artifactId, campaignId);

    const isInline = searchParams.get("view") === "1" || searchParams.get("inline") === "1";
    const disposition = isInline
      ? `inline; filename="${encodeURIComponent(filename)}"`
      : `attachment; filename="${encodeURIComponent(filename)}"`;

    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": disposition,
        "Content-Length": String(sizeBytes),
        "Cache-Control": isInline ? "private, max-age=3600" : "private, no-store, max-age=0",
      },
    });
  } catch (err: unknown) {
    if (err instanceof ArtifactNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ArtifactUnverifiedError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof InvalidPathAccessError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : "Internal Server Error";
    if (message.includes("Campaign not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

