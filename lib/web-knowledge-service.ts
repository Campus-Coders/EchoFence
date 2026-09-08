/**
 * EchoFence Web Knowledge & Current Fact Service
 *
 * Provides real-time external web knowledge retrieval for current factual inquiries
 * (e.g., richest person in India/world, current leaders, CEOs, populations, today's date).
 *
 * Race-Safety Invariants:
 * 1. Every lookup belongs to an active generation ID.
 * 2. Propagates AbortSignal to all internal network fetches.
 * 3. Immediately aborts in-flight network requests when a newer generation starts.
 * 4. Stale results are never committed to transcript or sent to Rime TTS.
 */

export interface WebFactResult {
  text: string;
  source: string;
  generationId?: number;
  aborted?: boolean;
}

export class WebKnowledgeService {
  /**
   * Main entry point to retrieve and synthesize current factual information.
   */
  public async lookupCurrentFact(
    query: string,
    options?: { signal?: AbortSignal; generationId?: number }
  ): Promise<WebFactResult> {
    const signal = options?.signal;
    const lower = query.toLowerCase().trim();

    // 1. Date and Time queries (instant, deterministic system clock)
    if (
      lower.includes("today's date") ||
      lower.includes("current date") ||
      lower.includes("what date") ||
      lower.includes("what day is it") ||
      lower.includes("current year")
    ) {
      const now = new Date();
      const dateStr = now.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      return {
        text: `Today is ${dateStr}.`,
        source: "System Clock",
        generationId: options?.generationId,
      };
    }

    // 2. Multi-tier external web lookup with AbortSignal support
    try {
      const [wikiResult, ddgResult] = await Promise.allSettled([
        this.lookupWikipedia(query, signal),
        this.lookupDuckDuckGo(query, signal),
      ]);

      const wiki = wikiResult.status === "fulfilled" ? wikiResult.value : null;
      const ddg = ddgResult.status === "fulfilled" ? ddgResult.value : null;

      const synthesizedText = this.synthesizeNaturalAnswer(query, wiki, ddg);

      return {
        text: synthesizedText,
        source: wiki?.source || ddg?.source || "Current Web Records",
        generationId: options?.generationId,
      };
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") {
        return {
          text: "",
          source: "Aborted",
          generationId: options?.generationId,
          aborted: true,
        };
      }

      console.warn("[web-knowledge-service] Lookup failed:", err);
      return {
        text: `Based on current factual records regarding "${query.slice(0, 50)}", please check verified official news sources for the latest figures.`,
        source: "Fallback",
        generationId: options?.generationId,
      };
    }
  }

  /**
   * Wikipedia REST API and search query resolution with AbortSignal.
   */
  private async lookupWikipedia(
    query: string,
    signal?: AbortSignal
  ): Promise<{ source: string; title: string; extract: string } | null> {
    const searchTerms = this.buildSearchCandidates(query);

    for (const term of searchTerms) {
      if (signal?.aborted) throw new Error("AbortError");

      try {
        // Direct summary if candidate matches an exact known article title
        const directUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
          term.replace(/ /g, "_")
        )}`;
        const directRes = await fetch(directUrl, {
          headers: {
            "User-Agent": "EchoFence/1.0 (https://echofence.internal; voice-agent@echofence.internal)",
          },
          signal,
        });

        if (directRes.ok) {
          const directData = (await directRes.json()) as {
            extract?: string;
            type?: string;
            title?: string;
          };
          if (
            directData.extract &&
            directData.type !== "disambiguation" &&
            directData.extract.length > 50
          ) {
            return {
              source: "Wikipedia",
              title: directData.title || term,
              extract: directData.extract,
            };
          }
        }

        // Search list
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
          term
        )}&utf8=&format=json`;
        const searchRes = await fetch(searchUrl, {
          headers: {
            "User-Agent": "EchoFence/1.0 (https://echofence.internal; voice-agent@echofence.internal)",
          },
          signal,
        });

        if (searchRes.ok) {
          const searchData = (await searchRes.json()) as {
            query?: { search?: Array<{ title: string; snippet?: string }> };
          };
          const hits = searchData.query?.search || [];
          for (const hit of hits.slice(0, 3)) {
            if (signal?.aborted) throw new Error("AbortError");

            const hitUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
              hit.title.replace(/ /g, "_")
            )}`;
            const hitRes = await fetch(hitUrl, {
              headers: {
                "User-Agent":
                  "EchoFence/1.0 (https://echofence.internal; voice-agent@echofence.internal)",
              },
              signal,
            });

            if (hitRes.ok) {
              const hitData = (await hitRes.json()) as {
                extract?: string;
                type?: string;
                title?: string;
              };
              if (
                hitData.extract &&
                hitData.type !== "disambiguation" &&
                hitData.extract.length > 50
              ) {
                return {
                  source: "Wikipedia",
                  title: hitData.title || hit.title,
                  extract: hitData.extract,
                };
              }
            }
          }
        }
      } catch (err: unknown) {
        if ((err as Error)?.name === "AbortError") throw err;
      }
    }

    return null;
  }

  /**
   * DuckDuckGo snippet extraction with browser headers and AbortSignal.
   */
  private async lookupDuckDuckGo(
    query: string,
    signal?: AbortSignal
  ): Promise<{ source: string; snippets: string[] } | null> {
    if (signal?.aborted) throw new Error("AbortError");

    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal,
      });

      if (!res.ok) return null;

      const html = await res.text();
      const snippets: string[] = [];
      const regex = /<a class="result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(html)) !== null && snippets.length < 3) {
        const raw = match[1] || "";
        const clean = raw
          .replace(/<[^>]+>/g, "")
          .replace(/&#x27;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&")
          .replace(/\s+/g, " ")
          .trim();
        if (clean.length > 20) {
          snippets.push(clean);
        }
      }

      if (snippets.length > 0) {
        return { source: "Current Web Search", snippets };
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") throw err;
    }

    return null;
  }

  /**
   * Search term generation based on question semantics.
   */
  private buildSearchCandidates(query: string): string[] {
    const candidates = [query];
    const lower = query.toLowerCase();

    if (lower.includes("richest") && lower.includes("india")) {
      candidates.unshift("List of Indians by net worth", "richest person in india list");
    } else if (lower.includes("richest") && (lower.includes("world") || lower.includes("globe"))) {
      candidates.unshift("The World's Billionaires", "richest person in the world");
    } else if (
      lower.includes("prime minister") &&
      (lower.includes("uk") || lower.includes("united kingdom") || lower.includes("britain"))
    ) {
      candidates.unshift(
        "Prime Minister of the United Kingdom",
        "List of prime ministers of the United Kingdom"
      );
    } else if (
      lower.includes("president") &&
      (lower.includes("us") || lower.includes("united states") || lower.includes("america"))
    ) {
      candidates.unshift("President of the United States");
    } else if (lower.includes("ceo") && (lower.includes("microsoft") || lower.includes("apple") || lower.includes("google"))) {
      const match = lower.match(/(microsoft|apple|google|meta|amazon|tesla)/);
      if (match && match[1]) {
        candidates.unshift(match[1]);
      }
    }

    return candidates;
  }

  /**
   * Synthesizes retrieved web facts into a concise natural language spoken response.
   */
  private synthesizeNaturalAnswer(
    query: string,
    wiki: { source: string; title: string; extract: string } | null,
    ddg: { source: string; snippets: string[] } | null
  ): string {
    // 1. Dynamic extraction from Wikipedia extract
    if (wiki?.extract) {
      const cleanExtract = wiki.extract.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
      const sentences = cleanExtract.split(/(?<=[.?!])\s+/).filter((s) => s.trim().length > 15);

      if (sentences.length > 0) {
        let lead = this.cleanSentence(sentences[0] || "");
        // If first sentence is meta (e.g. "The list of richest Indians by net worth..."), extract informative clause
        if (
          sentences.length > 1 &&
          (lead.toLowerCase().startsWith("the list of") ||
            lead.toLowerCase().startsWith("this is a list") ||
            lead.toLowerCase().startsWith("this list"))
        ) {
          // Check next sentences for the main subject/leader
          const second = this.cleanSentence(sentences[1] || "");
          const third = sentences[2] ? this.cleanSentence(sentences[2]) : "";
          if (third.length > 25 && (third.includes("richest") || third.includes("chairman") || third.includes("shareholder"))) {
            lead = third;
          } else if (second.length > 25) {
            lead = second;
          }
        }

        if (lead.length > 20) {
          return `According to current records from ${wiki.source}: ${lead}`;
        }
      }
    }

    // 2. Dynamic extraction from DuckDuckGo snippets
    if (ddg?.snippets && ddg.snippets.length > 0) {
      for (const snippet of ddg.snippets) {
        const cleaned = this.cleanSentence(snippet);
        if (cleaned.length > 30) {
          const truncated = cleaned.length > 220 ? `${cleaned.slice(0, 220)}...` : cleaned;
          return `Based on current web records: ${truncated}${truncated.endsWith(".") ? "" : "."}`;
        }
      }
    }

    // 3. Graceful factual fallback without exposure of internal mechanism words
    return `I retrieved current information regarding "${query.slice(
      0,
      50
    )}", but could not find a confirmed single authoritative figure.`;
  }

  private cleanSentence(text: string): string {
    return text
      .replace(/\s+/g, " ")
      .replace(/\([^)]*\)/g, "")
      .replace(/\[[^\]]*\]/g, "")
      .trim();
  }
}

export const webKnowledgeService = new WebKnowledgeService();
