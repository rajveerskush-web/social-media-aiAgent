import { updateSession } from "@insforge/sdk/ssr/middleware";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });

  await updateSession({
    requestCookies: request.cookies,
    responseCookies: response.cookies,
  });

  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/create-campaign/:path*",
    "/ai-agent/:path*",
    "/posts/:path*",
    "/calendar/:path*",
    "/analytics/:path*",
    "/accounts/:path*",
    "/settings/:path*",
    "/api/agent-chat/:path*",
    "/sign-in",
    "/sign-up",
  ],
};
