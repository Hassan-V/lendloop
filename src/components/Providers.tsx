"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useMemo } from "react";
import { SetupFallback } from "./SetupFallback";

function isConfiguredValue(val: string | undefined): val is string {
  return Boolean(val && !val.includes("replace_me") && !val.includes("your-"));
}

export function Providers({ children }: { children: React.ReactNode }) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  const isConfigured =
    isConfiguredValue(convexUrl) && isConfiguredValue(clerkKey);

  const convexClient = useMemo(() => {
    if (!isConfigured || !convexUrl) return null;
    return new ConvexReactClient(convexUrl);
  }, [isConfigured, convexUrl]);

  if (!isConfigured || !convexClient) {
    return <SetupFallback />;
  }

  return (
    <ClerkProvider publishableKey={clerkKey}>
      <ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
