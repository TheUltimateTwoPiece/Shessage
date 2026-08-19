"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

export function useUserSearch(excludeId: string | undefined) {
  const [query, setQuery] = useState("");
  const [rawResults, setRawResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 1 || !excludeId) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, email, avatar_url")
        .neq("id", excludeId)
        .or(`display_name.ilike.%${q}%,email.ilike.%${q}%`)
        .limit(10);
      if (!cancelled) {
        setRawResults((data ?? []) as Profile[]);
        setSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, excludeId]);

  // Results are only meaningful while there is a query.
  return {
    query,
    setQuery,
    results: query.trim().length > 0 ? rawResults : [],
    searching,
  };
}
