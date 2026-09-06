import type { SpeechProvider } from "@/types/provider";
import { rimeProvider } from "./rime-client";

/**
 * Provider Registry for Speech Providers.
 * Manages active provider resolution and facilitates future provider pluggability.
 */
class SpeechProviderRegistry {
  private providers = new Map<string, SpeechProvider>();
  private activeProviderId: string = "rime";

  constructor() {
    this.register(rimeProvider);
  }

  public register(provider: SpeechProvider): void {
    this.providers.set(provider.id.toLowerCase(), provider);
  }

  public getActiveProvider(): SpeechProvider {
    const provider = this.providers.get(this.activeProviderId.toLowerCase());
    if (!provider) {
      return rimeProvider;
    }
    return provider;
  }

  public setActiveProvider(providerId: string): void {
    const id = providerId.toLowerCase();
    if (!this.providers.has(id)) {
      throw new Error(`Unknown speech provider: ${providerId}`);
    }
    this.activeProviderId = id;
  }

  public listProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}

export const providerRegistry = new SpeechProviderRegistry();

export function getActiveSpeechProvider(): SpeechProvider {
  return providerRegistry.getActiveProvider();
}
