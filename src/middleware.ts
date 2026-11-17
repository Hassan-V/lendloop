import { clerkMiddleware } from "@clerk/nextjs/server";

// Keep "/" completely free of edge auth handshake redirects so unauthenticated
// visitors load the sanitized public tools board in a single request.
// All protected mutations and private queries enforce Clerk JWT identity + RBAC server-side in Convex.
export default clerkMiddleware();

export const config = {
  matcher: ["/(api|trpc)(.*)"],
};
