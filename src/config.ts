// Centralized configuration for AI models and API settings

const AVAILABLE_MODELS: Record<string, ModelConfig> = {};

export interface ModelConfig {
  name: string;
  displayName: string;
  description: string;
  contextWindow: number;
  provider: 'openai' | 'anthropic' | 'ollama' | 'other';
}

export interface APIConfig {
  baseURL: string;
  apiKey: string;
  defaultModel: string;
}

/**
  // * Global API configuration
    */
class ConfigManager {
  private config: APIConfig;

  constructor() {
    // Initialize from environment variables
    this.config = {
      baseURL: process.env.OPENAI_BASE_URL || 'http://host.docker.internal:22434',
      apiKey: process.env.OPENAI_API_KEY || '',
      defaultModel: process.env.DEFAULT_MODEL || '',
    };
  }
  get(key: keyof APIConfig): string {
    return this.config[key];
  }

  getBaseURL(): string {
    const baseURL = config.get("baseURL");
    return baseURL;
  }
  getDefaultModel(): string {
    // Return the configured default model, or fallback to first available model
    if (this.config.defaultModel) {
      return this.config.defaultModel;
    }
    const firstModel = Object.keys(AVAILABLE_MODELS)[0];
    return firstModel || '';
  }

  async initializeDefaultModel(): Promise<void> {
    // If no default model is set, fetch from API and set the first one
    if (!this.config.defaultModel) {
      console.log('No default model set, fetching from API...');
      await enrichModels();
      const availableModels = Object.keys(AVAILABLE_MODELS);
      if (availableModels.length > 0) {
        this.config.defaultModel = availableModels[0];
        console.log('Default model set to:', this.config.defaultModel);
      } else {
        console.warn('No models available from API. Default model will be empty.');
      }
    } else {
      console.log('Using configured default model:', this.config.defaultModel);
    }
  }

  getApiKey(): string {
    const apiKey = config.get("apiKey");
    return apiKey;
  }
}


export const config = new ConfigManager();


/**
 * Fetches the list of models from the server.
 * Supports multiple API formats (OpenAI, Ollama, etc.)
 */
async function fetchModelsFromAPI(): Promise<Record<string, ModelConfig>> {
  try {
    const response = await fetch(`${config.get('baseURL')}/models`, {
      headers: {
        Authorization: `Bearer ${config.get('apiKey')}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.status}`);
    }
    const data: any = await response.json();
    console.log('Fetched models from API:', JSON.stringify(data, null, 2));
    
    const record: Record<string, ModelConfig> = {};
    
    // Handle OpenAI-style response: { data: [...] }
    if (data.data && Array.isArray(data.data)) {
      for (const model of data.data) {
        const modelName = model.id || model.name;
        if (modelName) {
          record[modelName] = {
            name: modelName,
            displayName: model.displayName || modelName,
            description: model.description || '',
            contextWindow: model.contextWindow || model.context_length || 4096,
            provider: model.provider || 'other',
          };
        }
      }
    }
    // Handle Ollama-style response: { models: [...] }
    else if (data.models && Array.isArray(data.models)) {
      for (const model of data.models) {
        const modelName = model.name || model.model;
        if (modelName) {
          record[modelName] = {
            name: modelName,
            displayName: model.displayName || modelName,
            description: model.description || '',
            contextWindow: model.contextWindow || 4096,
            provider: 'ollama',
          };
        }
      }
    }
    // Handle plain array
    else if (Array.isArray(data)) {
      for (const model of data) {
        const modelName = model.id || model.name || model.model;
        if (modelName) {
          record[modelName] = {
            name: modelName,
            displayName: model.displayName || modelName,
            description: model.description || '',
            contextWindow: model.contextWindow || model.context_length || 4096,
            provider: model.provider || 'other',
          };
        }
      }
    }
    
    console.log(`Loaded ${Object.keys(record).length} models from API`);
    return record;
  } catch (err) {
    console.warn('Failed to fetch models from API:', err);
    // Return an empty record so we can fall back to the hard‑coded list
    return {};
  }
}

/**
 * Enrich AVAILABLE_MODELS with the first model fetched from the API (if any).
 * The full list from the API is merged, but the default model is set to the
 * first entry of the merged list. If the API call fails, the fallback list is
 * used and the default remains the first hard‑coded model.
 */
async function enrichModels(): Promise<void> {
  const apiModels = await fetchModelsFromAPI();
  // Merge API models into the existing map (API models take precedence)
  Object.assign(AVAILABLE_MODELS, apiModels);

  // Merge API models into the existing map (API models take precedence)

  // Determine the default model: first key of the merged map
  const mergedKeys = Object.keys(AVAILABLE_MODELS);
  // Update the ConfigManager's defaultModel if it exists
  // (Here we simply expose a separate export for convenience)
  Object.keys(mergedKeys);

}

// Initialize models on startup
export async function initializeConfig(): Promise<void> {
  await config.initializeDefaultModel();
}

// Auto-initialize when the module loads
initializeConfig().catch(err => {
  console.error('Failed to initialize config:', err);
});
