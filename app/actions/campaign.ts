"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { campaignIcons, officeOptions } from "@/lib/campaign-options";
import { campaign, getDb } from "@/db";
import { clearCurrentCampaignSelection, saveCurrentCampaignSelection } from "@/lib/campaign-selection";
import { createInsForgeServerClient, getAuthenticatedUser, persistAuthenticatedUserProfile } from "@/lib/insforge/server";

const acceptedMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const maxIconBytes = 256 * 1024;

function hasImageSignature(bytes: Buffer, mime: string) {
  if (mime === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return mime === "image/webp"
    && bytes.toString("ascii", 0, 4) === "RIFF"
    && bytes.toString("ascii", 8, 12) === "WEBP";
}

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

function logCampaignInsertFailure(error: unknown) {
  const details = error instanceof Error ? error as Error & {
    code?: unknown;
    constraint?: unknown;
    table?: unknown;
    column?: unknown;
  } : null;

  console.error("[campaign:create] Database insert failed", {
    errorName: details?.name ?? "UnknownError",
    ...(typeof details?.code === "string" ? { code: details.code } : {}),
    ...(typeof details?.constraint === "string" ? { constraint: details.constraint } : {}),
    ...(typeof details?.table === "string" ? { table: details.table } : {}),
    ...(typeof details?.column === "string" ? { column: details.column } : {}),
  });
}

export async function createCampaign(formData: FormData): Promise<{ error?: string }> {
  const name = value(formData, "name");
  const iconKey = value(formData, "iconKey");
  const officeImage = value(formData, "officeImage");
  const iconEntry = formData.get("iconImage");
  const iconFile = typeof File !== "undefined" && iconEntry instanceof File && iconEntry.size > 0 ? iconEntry : null;

  if (name.length < 2 || name.length > 80) return { error: "Campaign names must be between 2 and 80 characters." };
  if (!officeOptions.some((office) => office.id === officeImage)) return { error: "Choose an AI Agent Office to continue." };
  if (iconKey && !campaignIcons.some((icon) => icon.key === iconKey)) return { error: "Choose one of the available campaign icons." };
  if (iconFile && (!acceptedMimeTypes.has(iconFile.type) || iconFile.size > maxIconBytes)) {
    return { error: "Use a PNG, JPEG, or WebP icon under 256 KB." };
  }
  if (Boolean(iconKey) === Boolean(iconFile)) return { error: "Select an icon or upload a custom one." };

  const insforge = await createInsForgeServerClient();
  const { data, error: authError } = await insforge.auth.getCurrentUser();
  const user = data?.user;
  if (authError || !user?.id || !user.email) redirect("/sign-in");

  const profile = await persistAuthenticatedUserProfile(insforge);
  if (profile.error) return { error: "We could not prepare your account yet. Please try again." };

  let iconBytes: Buffer | null = null;
  if (iconFile) {
    iconBytes = Buffer.from(await iconFile.arrayBuffer());
    if (!hasImageSignature(iconBytes, iconFile.type)) return { error: "That file is not a valid PNG, JPEG, or WebP image." };
  }

  let createdCampaign: { id: number } | undefined;
  try {
    [createdCampaign] = await getDb().insert(campaign).values({
      authUserId: user.id,
      name,
      iconKey: iconFile ? null : iconKey,
      iconImage: iconBytes,
      iconImageMime: iconFile?.type ?? null,
      officeImage,
    }).returning({ id: campaign.id });
  } catch (error) {
    logCampaignInsertFailure(error);
    return { error: "We could not save your campaign. Please try again." };
  }

  if (!createdCampaign) {
    console.error("[campaign:create] Database insert returned no campaign row");
    return { error: "We could not save your campaign. Please try again." };
  }

  await saveCurrentCampaignSelection(createdCampaign.id);
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function selectCampaign(campaignId: number): Promise<{ error?: string }> {
  const user = await getAuthenticatedUser();
  if (!user?.id) redirect("/sign-in");
  if (!Number.isSafeInteger(campaignId) || campaignId <= 0) {
    return { error: "Choose a valid campaign." };
  }

  try {
    const [ownedCampaign] = await getDb()
      .select({ id: campaign.id })
      .from(campaign)
      .where(and(eq(campaign.id, campaignId), eq(campaign.authUserId, user.id)))
      .limit(1);
    if (!ownedCampaign) return { error: "That campaign is not available in your workspace." };
  } catch {
    return { error: "We could not switch campaigns right now. Please try again." };
  }

  await saveCurrentCampaignSelection(campaignId);
  revalidatePath("/dashboard");
  return {};
}

export async function deleteCampaign(campaignId: number): Promise<{ error?: string; redirectTo?: "/dashboard" | "/create-campaign" }> {
  const user = await getAuthenticatedUser();
  if (!user?.id) redirect("/sign-in");
  if (!Number.isSafeInteger(campaignId) || campaignId <= 0) {
    return { error: "Choose a valid campaign to delete." };
  }

  try {
    const result = await getDb().transaction(async (tx) => {
      const [deleted] = await tx
        .delete(campaign)
        .where(and(eq(campaign.id, campaignId), eq(campaign.authUserId, user.id)))
        .returning({ id: campaign.id });

      if (!deleted) return { deleted: false as const, nextCampaignId: null };

      const [remainingCampaign] = await tx
        .select({ id: campaign.id })
        .from(campaign)
        .where(eq(campaign.authUserId, user.id))
        .orderBy(asc(campaign.createdAt), asc(campaign.id))
        .limit(1);

      return { deleted: true as const, nextCampaignId: remainingCampaign?.id ?? null };
    });

    if (!result.deleted) return { error: "That campaign is not available in your workspace." };

    if (result.nextCampaignId !== null) {
      await saveCurrentCampaignSelection(result.nextCampaignId);
    } else {
      await clearCurrentCampaignSelection();
    }

    revalidatePath("/dashboard");
    revalidatePath("/create-campaign");
    return { redirectTo: result.nextCampaignId === null ? "/create-campaign" : "/dashboard" };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    console.error("[campaign:delete] Database operation failed", { errorName });
    return { error: "We could not delete this campaign. Please try again." };
  }
}
