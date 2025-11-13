import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Centralized configuration for AI models and API settings
 */

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
 * Available models configuration
 */
export const AVAILABLE_MODELS: Record<string, ModelConfig> = {
  'nhn-large:fast': {
    name: 'nhn-large:fast',
    displayName: 'NHN Small (Fast)',
    description: 'Fast, lightweight model for quick tasks',
    contextWindow: 32000,
    provider: 'other',
  },
  'nhn-medium': {
    name: 'nhn-medium',
    displayName: 'NHN Medium',
    description: 'Balanced model for general tasks',
    contextWindow: 64000,
    provider: 'other',
  },
  'nhn-large:slow': {
    name: 'nhn-large:slow',
    displayName: 'NHN Large (Slow)',
    description: 'Powerful model for deep analysis',
    contextWindow: 128000,
    provider: 'other',
  },
  'gpt-3.5-turbo': {
    name: 'gpt-3.5-turbo',
    displayName: 'GPT-3.5 Turbo',
    description: 'OpenAI fast model',
    contextWindow: 16385,
    provider: 'openai',
  },
  'gpt-4': {
    name: 'gpt-4',
    displayName: 'GPT-4',
    description: 'OpenAI most capable model',
    contextWindow: 8192,
    provider: 'openai',
  },
  'gpt-4-turbo': {
    name: 'gpt-4-turbo',
    displayName: 'GPT-4 Turbo',
    description: 'OpenAI fast and capable model',
    contextWindow: 128000,
    provider: 'openai',
  },
};

/**
 * Global API configuration
 */
class ConfigManager {
  private config: APIConfig;
  private configPath: string;

  constructor() {
    // Define config path based on environment
    const isProduction = process.env.NODE_ENV === 'production';
    const configDir = isProduction
      ? path.join(os.homedir(), '.kitty')
      : path.join(os.tmpdir(), '.kitty');
    this.configPath = path.join(configDir, 'config.json');

    // Set default configuration
    this.config = {
      baseURL: 'http://host.docker.internal:22434',
      apiKey: '',
      defaultModel: 'nhn-large:fast',
    };

    // Load from file, which only contains the model
    this.loadConfig();

    // Override with environment variables
    if (process.env.OPENAI_BASE_URL) {
      this.config.baseURL = process.env.OPENAI_BASE_URL;
    }
    if (process.env.OPENAI_API_KEY) {
      this.config.apiKey = process.env.OPENAI_API_KEY;
    }
    if (process.env.DEFAULT_MODEL) {
      this.config.defaultModel = process.env.DEFAULT_MODEL;
    }

    // Validate the model
    if (!this.isModelAvailable(this.config.defaultModel)) {
      const availableModels = this.getAvailableModels();
      if (availableModels.length > 0) {
        this.config.defaultModel = availableModels[0].name;
      }
    }
  }

  private loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const fileContent = fs.readFileSync(this.configPath, 'utf-8');
        const savedConfig = JSON.parse(fileContent);
        if (savedConfig.defaultModel) {
          this.config.defaultModel = savedConfig.defaultModel;
        }
      }
    } catch (error) {
      // Ignore errors, use default/env config
    }
  }

  private saveConfig() {
    try {
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      // Only store the model
      const configToSave = { defaultModel: this.config.defaultModel };
      fs.writeFileSync(this.configPath, JSON.stringify(configToSave, null, 2));
    } catch (error) {
      // Ignore errors
    }
  }

  /**
   * Get current API configuration
   */
  getConfig(): APIConfig {
    return { ...this.config };
  }

  /**
   * Get base URL for API
   */
  getBaseURL(): string {
    return this.config.baseURL;
  }

  /**
   * Get API key
   */
  getApiKey(): string {
    return this.config.apiKey;
  }

  /**
   * Get default model name
   */
  getDefaultModel(): string {
    return this.config.defaultModel;
  }

  /**
   * Set base URL
   */
  setBaseURL(baseURL: string): void {
    this.config.baseURL = baseURL;
  }

  /**
   * Set API key
   */
  setApiKey(apiKey: string): void {
    this.config.apiKey = apiKey;
  }

  /**
   * Set default model and save it
   */
  setDefaultModel(modelName: string): void {
    this.config.defaultModel = modelName;
    this.saveConfig();
  }

  /**
   * Update configuration (only model is saved)
   */
  updateConfig(config: Partial<APIConfig>): void {
    if (config.baseURL !== undefined) this.config.baseURL = config.baseURL;
    if (config.apiKey !== undefined) this.config.apiKey = config.apiKey;
    if (config.defaultModel !== undefined) {
      this.config.defaultModel = config.defaultModel;
      this.saveConfig();
    }
  }

  /**
   * Get model configuration by name
   */
  getModelConfig(modelName: string): ModelConfig | undefined {
    return AVAILABLE_MODELS[modelName];
  }

  /**
   * Get all available models
   */
  getAvailableModels(): ModelConfig[] {
    return Object.values(AVAILABLE_MODELS);
  }

  /**
   * Check if a model is available in the registry
   */
  isModelAvailable(modelName: string): boolean {
    return modelName in AVAILABLE_MODELS;
  }

  /**
   * Fetch available models from the API endpoint
   * Uses OpenAI-compatible /v1/models endpoint
   */
  async fetchModelsFromAPI(): Promise<any[]> {
    try {
      const response = await fetch(`${this.config.baseURL}/v1/models`, {
        headers: this.config.apiKey ? {
          'Authorization': `Bearer ${this.config.apiKey}`
        } : {}
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }

      const data: any = await response.json();
      return data.data || [];
    } catch (error) {
      console.error('Error fetching models from API:', error);
      return [];
    }
  }

  /**
   * Register a new model dynamically
   */
  registerModel(config: ModelConfig): void {
    AVAILABLE_MODELS[config.name] = config;
  }

  /**
   * Unregister a model
   */
  unregisterModel(modelName: string): void {
    delete AVAILABLE_MODELS[modelName];
  }
}

// Singleton instance
export const config = new ConfigManager();

// Export for convenience
export const getConfig = () => config.getConfig();
export const getBaseURL = () => config.getBaseURL();
export const getApiKey = () => config.getApiKey();
export const getDefaultModel = () => config.getDefaultModel();
export const setDefaultModel = (model: string) => config.setDefaultModel(model);
export const getAvailableModels = () => config.getAvailableModels();
export const fetchModelsFromAPI = () => config.fetchModelsFromAPI();
