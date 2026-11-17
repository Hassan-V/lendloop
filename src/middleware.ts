import { clerkMiddleware } from "@clerk/nextjs/server";

// Public landing page stays unauthenticated (read-only tool names & categories).
// All state mutations and authenticated queries enforce JWT identity + RBAC server-side in Convex.
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
