export const defaultProviderPrefixes: Record<string, string> = {
  claude: 'anthropic',
  gpt: 'openai',
  chatgpt: 'openai',
  o1: 'openai',
  o3: 'openai',
  o4: 'openai',
  gemini: 'google',
  deepseek: 'deepseek',
  mistral: 'mistral',
  codestral: 'mistral',
  qwen: 'alibaba',
  llama: 'meta',
};

export function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase();
}

export function resolveProvider(options: {
  model?: string | null;
  profile?: {
    provider?: string | null;
    harness?: string | null;
    model?: string | null;
  } | null;
  catalogProvider?: string | null;
  prefixOverrides?: Record<string, string> | null;
}): string | null {
  const { model, profile, catalogProvider, prefixOverrides } = options;

  // 1. Explicit catalog provider (e.g. Pi harness catalog)
  if (catalogProvider && catalogProvider.trim()) {
    return normalizeProvider(catalogProvider);
  }

  // 2. Explicit profile provider
  if (profile?.provider && profile.provider.trim()) {
    return normalizeProvider(profile.provider);
  }

  const effectiveModel = model?.trim() || profile?.model?.trim();
  if (effectiveModel) {
    // 3. Slash notation: provider/model (standard in Pi harness, e.g. "anthropic/claude-3-5-sonnet")
    if (effectiveModel.includes('/')) {
      const parts = effectiveModel.split('/');
      if (parts[0] && parts[0].trim()) {
        return normalizeProvider(parts[0]);
      }
    }

    const lowerModel = effectiveModel.toLowerCase();

    // 4. Configured local prefix table in server settings
    if (prefixOverrides) {
      for (const [prefix, prov] of Object.entries(prefixOverrides)) {
        if (
          prefix.trim() &&
          lowerModel.startsWith(prefix.trim().toLowerCase()) &&
          prov.trim()
        ) {
          return normalizeProvider(prov);
        }
      }
    }

    // 5. Default prefix table
    for (const [prefix, prov] of Object.entries(defaultProviderPrefixes)) {
      if (lowerModel.startsWith(prefix)) {
        return normalizeProvider(prov);
      }
    }
  }

  // 6. Harness-level fallback if profile harness is known
  if (profile?.harness) {
    if (profile.harness === 'claude-code') return 'anthropic';
    if (profile.harness === 'codex') return 'openai';
  }

  return null;
}
