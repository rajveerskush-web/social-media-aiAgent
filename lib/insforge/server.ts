import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@insforge/sdk/ssr";
import { campaign, getDb, users } from "@/db";
import { CURRENT_CAMPAIGN_COOKIE } from "@/lib/campaign-selection";
import { asc, eq } from "drizzle-orm";

export async function createInsForgeServerClient() {
  return createServerClient({ cookies: await cookies() });
}

export async function getAuthenticatedUser() {
  const insforge = await createInsForgeServerClient();
  const { data, error } = await insforge.auth.getCurrentUser();

  return error ? null : data.user;
}

/** Read the Neon profile for the verified InsForge server-session identity. */
export async function getAuthenticatedUserProfile() {
  const insforge = await createInsForgeServerClient();
  const { data, error } = await insforge.auth.getCurrentUser();
  const user = data?.user;
  if (error || !user?.id) return null;

  try {
    const [profile] = await getDb()
      .select()
      .from(users)
      .where(eq(users.authUserId, user.id))
      .limit(1);
    return profile ?? null;
  } catch {
    return null;
  }
}

/** Read all campaigns owned by the verified InsForge session identity. */
export async function getAuthenticatedUserCampaigns() {
  const insforge = await createInsForgeServerClient();
  const { data, error } = await insforge.auth.getCurrentUser();
  const user = data?.user;
  if (error || !user?.id) return [];

  return getCampaignsForAuthUser(user.id);
}

/** Resolve the selection only among campaigns owned by the verified user. */
export async function getAuthenticatedUserCampaign() {
  const insforge = await createInsForgeServerClient();
  const { data, error } = await insforge.auth.getCurrentUser();
  const user = data?.user;
  if (error || !user?.id) return null;

  const ownedCampaigns = await getCampaignsForAuthUser(user.id);
  if (ownedCampaigns.length === 0) return null;

  const requestedId = Number((await cookies()).get(CURRENT_CAMPAIGN_COOKIE)?.value);
  return ownedCampaigns.find((item) => item.id === requestedId) ?? ownedCampaigns[0];
}

/** Internal lookup; callers must pass an ID returned by InsForge Auth. */
async function getCampaignsForAuthUser(authUserId: string) {
  try {
    const storedCampaigns = await getDb()
      .select()
      .from(campaign)
      .where(eq(campaign.authUserId, authUserId))
      .orderBy(asc(campaign.createdAt), asc(campaign.id));
    return storedCampaigns.map((storedCampaign) => ({
      ...storedCampaign,
      iconImage: storedCampaign.iconImage && storedCampaign.iconImageMime
        ? `data:${storedCampaign.iconImageMime};base64,${storedCampaign.iconImage.toString("base64")}`
        : null,
    }));
  } catch {
    return [];
  }
}

/** Choose the post-auth destination without accepting identity from the client. */
export async function getAuthenticatedCampaignDestination(
  insforge: Awaited<ReturnType<typeof createInsForgeServerClient>>,
) {
  const { data, error } = await insforge.auth.getCurrentUser();
  const user = data?.user;
  if (error || !user?.id) return "/sign-in";
  return (await getCampaignsForAuthUser(user.id)).length > 0 ? "/dashboard" : "/create-campaign";
}

/** Persist a Neon profile only for the user in the verified InsForge server session. */
export async function persistAuthenticatedUserProfile(
  insforge: Awaited<ReturnType<typeof createInsForgeServerClient>>,
  name?: string,
) {
  const { data, error: authError } = await insforge.auth.getCurrentUser();
  const user = data?.user;
  if (authError || !user?.id || !user.email) {
    return { error: authError ?? new Error("No verified InsForge user session.") };
  }

  const normalizedName = name?.trim() || user.profile?.name?.trim();
  const profile = {
    authUserId: user.id,
    email: user.email,
    name: normalizedName ?? null,
  };

  try {
    // Conflict resolution by verified InsForge UUID makes signup, verification,
    // OAuth callbacks, and later sign-ins safe to repeat.
    await getDb()
      .insert(users)
      .values(profile)
      .onConflictDoUpdate({
        target: users.authUserId,
        set: {
          email: profile.email,
          ...(normalizedName ? { name: normalizedName } : {}),
        },
      });
    return { error: null };
  } catch (error) {
    return {
      error: error instanceof Error ? error : new Error("Unable to save the user profile in Neon."),
    };
  }

}
