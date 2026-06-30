"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import type { UserProfile } from "@/lib/client-types";

// Loads the caller's profile (creating it on first call) once authenticated.
export function useProfile() {
  const { user, loading, authedFetch } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setProfileLoading(false);
      return;
    }
    authedFetch("/api/me")
      .then((r) => r.json())
      .then((d) => setProfile(d.profile ?? null))
      .catch(() => setProfile(null))
      .finally(() => setProfileLoading(false));
  }, [user, loading, authedFetch]);

  return { user, profile, loading: loading || profileLoading };
}

// Guards tutor-only pages: redirects students to /dashboard and signed-out
// users to /login.
export function useRequireTutor() {
  const { user, profile, loading } = useProfile();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (profile && profile.role !== "tutor") router.replace("/dashboard");
  }, [user, profile, loading, router]);

  return { user, profile, loading };
}
