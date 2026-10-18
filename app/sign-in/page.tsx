import { AuthForm } from "@/components/auth/auth-form";
import { getAuthenticatedUser } from "@/lib/insforge/server";
import { redirect } from "next/navigation";

type SignInPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const user = await getAuthenticatedUser();
  if (user) redirect("/dashboard");

  const { error } = await searchParams;
  const authError = error === "google"
    ? "Google sign-in couldn’t be completed. Please try again."
    : undefined;

  return <AuthForm mode="sign-in" authError={authError} />;
}
