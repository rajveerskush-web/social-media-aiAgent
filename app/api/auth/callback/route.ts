import { createAuthActions, createServerClient, getAccessTokenCookieName } from "@insforge/sdk/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedCampaignDestination, persistAuthenticatedUserProfile } from "@/lib/insforge/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("insforge_code");
  const oauthError = request.nextUrl.searchParams.get("error");
  const cookieStore = await cookies();
  const verifier = cookieStore.get("insforge_code_verifier")?.value;

  if (oauthError || !code || !verifier) {
    return NextResponse.redirect(new URL("/sign-in?error=google", request.url));
  }

  const response = NextResponse.redirect(new URL("/dashboard", request.url));
  const auth = createAuthActions({
    requestCookies: request.cookies,
    responseCookies: response.cookies,
  });
  const { data, error } = await auth.exchangeOAuthCode(code, verifier);

  if (error || !data?.user) {
    return NextResponse.redirect(new URL("/sign-in?error=google", request.url));
  }

  const accessToken = response.cookies.get(getAccessTokenCookieName())?.value;
  if (!accessToken) {
    return NextResponse.redirect(new URL("/sign-in?error=google", request.url));
  }
  const insforge = createServerClient({ accessToken });
  await persistAuthenticatedUserProfile(insforge);
  const destination = await getAuthenticatedCampaignDestination(insforge);
  response.cookies.delete("insforge_code_verifier");
  response.headers.set("Location", new URL(destination, request.url).toString());
  return response;
}
