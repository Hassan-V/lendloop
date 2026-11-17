"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { SetupFallback } from "./SetupFallback";

interface AuthActivationState {
  authEnabled: boolean;
  autoOpenSignIn: boolean;
  requestSignIn: () => void;
  clearAutoOpen: () => void;
}

const AuthActivationContext = createContext<AuthActivationState>({
  authEnabled: false,
  autoOpenSignIn: false,
  requestSignIn: () => {},
  clearAutoOpen: () => {},
});

export function useAuthActivation() {
  return useContext(AuthActivationContext);
}

function isConfiguredValue(val: string | undefined): val is string {
  return Boolean(val && !val.includes("replace_me") && !val.includes("your-"));
}

function hasClerkBrowserCookie(): boolean {
  if (typeof document === "undefined") return false;
  return /(?:^|;\s*)(__session=[^;]+|__client_uat=[1-9])/.test(document.cookie);
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

  const [authEnabled, setAuthEnabled] = useState(false);
  const [autoOpenSignIn, setAutoOpenSignIn] = useState(false);

  useEffect(() => {
    if (hasClerkBrowserCookie()) {
      setAuthEnabled(true);
    }
  }, []);

  const ctxValue = useMemo<AuthActivationState>(
    () => ({
      authEnabled,
      autoOpenSignIn,
      requestSignIn: () => {
        setAuthEnabled(true);
        setAutoOpenSignIn(true);
      },
      clearAutoOpen: () => setAutoOpenSignIn(false),
    }),
    [authEnabled, autoOpenSignIn]
  );

  if (!isConfigured || !convexClient) {
    return <SetupFallback />;
  }

  return (
    <AuthActivationContext.Provider value={ctxValue}>
      {authEnabled ? (
        <ClerkProvider publishableKey={clerkKey}>
          <ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
            {children}
          </ConvexProviderWithClerk>
        </ClerkProvider>
      ) : (
        <ConvexProvider client={convexClient}>{children}</ConvexProvider>
      )}
    </AuthActivationContext.Provider>
  );
}
