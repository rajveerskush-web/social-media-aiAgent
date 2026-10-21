import { AuthForm } from "@/components/auth/auth-form";
import { getAuthenticatedUser, getAuthenticatedUserCampaign } from "@/lib/insforge/server";
import { redirect } from "next/navigation";

export default async function SignUpPage() {
  const user = await getAuthenticatedUser();
  if (user) redirect((await getAuthenticatedUserCampaign()) ? "/dashboard" : "/create-campaign");

  return <AuthForm mode="sign-up" />;
}
