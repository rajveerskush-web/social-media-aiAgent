"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { campaignIcons, officeOptions } from "@/lib/campaign-options";
import { campaign, getDb } from "@/db";
import { createInsForgeServerClient, persistAuthenticatedUserProfile } from "@/lib/insforge/server";

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

  const db = getDb();
  let existing: { id: number } | undefined;
  try {
    [existing] = await db
      .select({ id: campaign.id })
      .from(campaign)
      .where(eq(campaign.authUserId, user.id))
      .limit(1);
  } catch {
    return { error: "We couldn’t check your campaign right now. Please try again." };
  }
  if (existing) redirect("/dashboard");

  const profile = await persistAuthenticatedUserProfile(insforge);
  if (profile.error) return { error: "We couldn’t prepare your account yet. Please try again." };

  let iconBytes: Buffer | null = null;
  if (iconFile) {
    iconBytes = Buffer.from(await iconFile.arrayBuffer());
    if (!hasImageSignature(iconBytes, iconFile.type)) return { error: "That file is not a valid PNG, JPEG, or WebP image." };
  }

  let inserted: { id: number }[];
  try {
    inserted = await db.insert(campaign).values({
      authUserId: user.id,
      name,
      iconKey: iconFile ? null : iconKey,
      iconImage: iconBytes,
      iconImageMime: iconFile?.type ?? null,
      officeImage,
    }).onConflictDoNothing({ target: campaign.authUserId }).returning({ id: campaign.id });
  } catch {
    return { error: "We couldn’t save your campaign. Please try again." };
  }

  if (inserted.length === 0) {
    try {
      const [createdByOtherRequest] = await db.select({ id: campaign.id }).from(campaign).where(eq(campaign.authUserId, user.id)).limit(1);
      if (createdByOtherRequest) redirect("/dashboard");
    } catch (error) {
      if (error && typeof error === "object" && "digest" in error) throw error;
      return { error: "We couldn’t confirm your campaign was saved. Please refresh and try again." };
    }
    return { error: "We couldn’t save your campaign. Please try again." };
  }

  redirect("/dashboard");
}
