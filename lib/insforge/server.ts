import { cookies } from "next/headers";
import { createServerClient } from "@insforge/sdk/ssr";
import { getDb, users } from "@/db";
import { eq } from "drizzle-orm";

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
