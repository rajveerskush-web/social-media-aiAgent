import { redirect } from "next/navigation";

type SignInAliasProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function SignInAliasPage({ searchParams }: SignInAliasProps) {
  const { error } = await searchParams;
  redirect(error ? `/sign-in?error=${encodeURIComponent(error)}` : "/sign-in");
}

