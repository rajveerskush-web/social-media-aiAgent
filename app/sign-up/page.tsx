import { AuthForm } from "@/components/auth/auth-form";
import { getAuthenticatedUser } from "@/lib/insforge/server";
import { redirect } from "next/navigation";

export default async function SignUpPage() {
  const user = await getAuthenticatedUser();
  if (user) redirect("/dashboard");

  return <AuthForm mode="sign-up" />;
}
