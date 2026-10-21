"use server";

import { createAuthActions } from "@insforge/sdk/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createInsForgeServerClient, getAuthenticatedCampaignDestination, persistAuthenticatedUserProfile } from "@/lib/insforge/server";

type AuthActionResult = {
  error?: string;
  verificationRequired?: boolean;
};

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function signInWithEmail(formData: FormData): Promise<AuthActionResult> {
  const email = getString(formData, "email").toLowerCase();
  const password = getString(formData, "password");

  if (!email || !password) return { error: "Enter your email and password." };

  const auth = createAuthActions({ cookies: await cookies() });
  const { data, error } = await auth.signInWithPassword({ email, password });

  if (error || !data?.user) {
    return { error: error?.message ?? "We couldn’t sign you in. Please try again." };
  }

  const insforge = await createInsForgeServerClient();
  await persistAuthenticatedUserProfile(insforge);
  redirect(await getAuthenticatedCampaignDestination(insforge));
}

export async function signUpWithEmail(formData: FormData): Promise<AuthActionResult> {
  const name = getString(formData, "name");
  const email = getString(formData, "email").toLowerCase();
  const password = getString(formData, "password");

  if (!name || !email || !password) {
    return { error: "Enter your name, email, and password." };
  }
  if (name.length > 100) return { error: "Your name must be 100 characters or fewer." };
  if (password.length < 6) return { error: "Your password must be at least 6 characters." };

  const auth = createAuthActions({ cookies: await cookies() });
  const { data, error } = await auth.signUp({ email, password, name });

  if (error) return { error: error.message };
  if (data?.requireEmailVerification) return { verificationRequired: true };
  if (!data?.user) return { error: "We couldn’t finish creating your account. Please try again." };

  const insforge = await createInsForgeServerClient();
  await persistAuthenticatedUserProfile(insforge, name);
  redirect(await getAuthenticatedCampaignDestination(insforge));
}

export async function verifySignUpEmail(formData: FormData): Promise<AuthActionResult> {
  const email = getString(formData, "email").toLowerCase();
  const otp = getString(formData, "otp").replace(/\s/g, "");

  if (!email || !/^\d{6}$/.test(otp)) {
    return { error: "Enter the six-digit code sent to your email." };
  }

  const auth = createAuthActions({ cookies: await cookies() });
  const { data, error } = await auth.verifyEmail({ email, otp });

  if (error || !data?.user) {
    return { error: error?.message ?? "We couldn’t verify that code. Please check it and try again." };
  }

  const insforge = await createInsForgeServerClient();
  await persistAuthenticatedUserProfile(insforge);
  redirect(await getAuthenticatedCampaignDestination(insforge));
}

export async function startGoogleSignIn() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) redirect("/sign-in?error=google");

  const cookieStore = await cookies();
  const auth = createAuthActions({ cookies: cookieStore });
  const { data, error } = await auth.signInWithOAuth("google", {
    redirectTo: new URL("/api/auth/callback", appUrl).toString(),
    additionalParams: { prompt: "select_account" },
    skipBrowserRedirect: true,
  });

  if (error || !data.url || !data.codeVerifier) redirect("/sign-in?error=google");

  cookieStore.set("insforge_code_verifier", data.codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  redirect(data.url);
}

export async function signOut() {
  const auth = createAuthActions({ cookies: await cookies() });
  await auth.signOut();
  redirect("/sign-in");
}
