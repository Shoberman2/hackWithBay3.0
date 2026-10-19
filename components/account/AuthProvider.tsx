"use client";

/**
 * App-wide auth context. Reads /api/auth/me once on mount and exposes the
 * current user plus refresh/signOut. Every gated surface (onboarding, the
 * session view) reads this instead of fetching independently.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export interface AuthUser {
  id: string;
  email: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  refresh: async () => {},
  signOut: async () => {},
});

const AUTH_CACHE_KEY = "rivalry_auth_user";

function readCachedUser(): AuthUser | null {
  try {
    const raw = window.localStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthUser>;
    return typeof parsed.id === "string" && typeof parsed.email === "string"
      ? { id: parsed.id, email: parsed.email }
      : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: AuthUser | null): void {
  try {
    if (user) {
      window.localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(user));
    } else {
      window.localStorage.removeItem(AUTH_CACHE_KEY);
    }
  } catch {
    // Storage is an optimization; auth still works without it.
  }
}

export function cacheAuthUser(user: AuthUser): void {
  writeCachedUser(user);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const cached = readCachedUser();
    if (cached) {
      setUser(cached);
      setLoading(false);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch("/api/auth/me", {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = (await res.json()) as { user: AuthUser | null };
      setUser(body.user ?? null);
      writeCachedUser(body.user ?? null);
    } catch {
      if (!cached) setUser(null);
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } finally {
      writeCachedUser(null);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
