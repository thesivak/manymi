import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { isClerkConfigured } from "@/lib/clerk-config";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/api/health",
  "/api/mcp",
]);

const handler = clerkMiddleware(async (auth, request) => {
  if (request.nextUrl.pathname.startsWith("/sign-up")) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  if (request.nextUrl.pathname.startsWith("/sign-up")) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  if (!isClerkConfigured()) {
    return NextResponse.next();
  }
  return handler(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
