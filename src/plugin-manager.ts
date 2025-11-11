import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { Tool } from './plugins.js';

export interface PluginMetadata {
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  installDate: string;
  enabled: boolean;
  source: string; // URL or 'local'
}

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  main: string; // Entry point file (relative path within plugin)
  tools?: string[]; // Optional: list of exported tool names
}

export interface Plugin {
  metadata: PluginMetadata;
  tools: Tool[];
}

export class PluginManager {
  private pluginDir: string;
  private metadataFile: string;
  private plugins: Map<string, Plugin> = new Map();

  constructor(customPluginDir?: string) {
    this.pluginDir = customPluginDir || path.join(os.homedir(), '.kitty', 'plugins');
    this.metadataFile = path.join(this.pluginDir, 'metadata.json');
  }

  async initialize(): Promise<void> {
    // Create plugin directory if it doesn't exist
    await fs.mkdir(this.pluginDir, { recursive: true });
    
    // Load existing plugins
    await this.loadAllPlugins();
  }

  private async loadAllPlugins(): Promise<void> {
    try {
      const metadataContent = await fs.readFile(this.metadataFile, 'utf-8');
      const allMetadata: Record<string, PluginMetadata> = JSON.parse(metadataContent);

      for (const [pluginName, metadata] of Object.entries(allMetadata)) {
        if (metadata.enabled) {
          try {
            await this.loadPlugin(pluginName, metadata);
          } catch (error) {
            console.error(`Failed to load plugin ${pluginName}:`, error);
          }
        }
      }
    } catch (error) {
      // No metadata file yet or error reading it
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Error loading plugin metadata:', error);
      }
    }
  }

  private async loadPlugin(pluginName: string, metadata: PluginMetadata): Promise<void> {
    const pluginPath = path.join(this.pluginDir, pluginName);
    
    // Try to find manifest file (support both JSON and YAML)
    let manifestPath: string | null = null;
    let manifest: PluginManifest;
    
    for (const ext of ['plugin.json', 'plugin.yaml', 'plugin.yml']) {
      const testPath = path.join(pluginPath, ext);
      try {
        await fs.access(testPath);
        manifestPath = testPath;
        break;
      } catch {
        // File doesn't exist, try next
      }
    }
    
    if (!manifestPath) {
      throw new Error(`No plugin manifest found (tried plugin.json, plugin.yaml, plugin.yml)`);
    }

    try {
      // Read and parse manifest
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      
      if (manifestPath.endsWith('.json')) {
        manifest = JSON.parse(manifestContent);
      } else {
        // YAML
        manifest = yaml.load(manifestContent) as PluginManifest;
      }

      // Load the main file
      const mainPath = path.join(pluginPath, manifest.main);
      const pluginModule = await import(`file://${mainPath}`);

      // Extract tools from the module
      const tools: Tool[] = [];
      
      if (pluginModule.tools && Array.isArray(pluginModule.tools)) {
        tools.push(...pluginModule.tools);
      } else if (pluginModule.default) {
        // Single tool export
        if (this.isValidTool(pluginModule.default)) {
          tools.push(pluginModule.default);
        }
      }

      // Validate tools
      for (const tool of tools) {
        if (!this.isValidTool(tool)) {
          const toolName = typeof tool === 'object' && tool && 'name' in tool ? (tool as any).name : 'unknown';
          throw new Error(`Invalid tool in plugin ${pluginName}: ${toolName}`);
        }
      }

      this.plugins.set(pluginName, { metadata, tools });
    } catch (error) {
      throw new Error(`Failed to load plugin ${pluginName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private isValidTool(obj: any): obj is Tool {
    return (
      obj &&
      typeof obj.name === 'string' &&
      typeof obj.description === 'string' &&
      obj.inputSchema &&
      typeof obj.execute === 'function'
    );
  }

  async installFromURL(url: string, force: boolean = false): Promise<void> {
    try {
      // Download the plugin file
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download plugin: ${response.statusText}`);
      }

      const content = await response.text();

      // Try to parse as JSON to see if it's a manifest or direct plugin
      let manifest: PluginManifest;
      let pluginCode: string;

      try {
        const json = JSON.parse(content);

        // Check if it's a manifest with embedded code
        if (json.manifest && json.code) {
          manifest = json.manifest;
          pluginCode = json.code;
        } else if (json.name && json.version && json.main) {
          // It's a manifest, need to download additional files
          manifest = json;
          // For simplicity, assume single-file plugins for URL installs
          throw new Error('Multi-file plugins not yet supported for URL installs. Use single-file format with manifest and code.');
        } else {
          throw new Error('Invalid plugin format');
        }
      } catch (parseError) {
        // Not JSON, treat as direct JavaScript/TypeScript code
        // Create a default manifest
        const pluginName = this.extractPluginNameFromURL(url);
        manifest = {
          name: pluginName,
          version: '1.0.0',
          description: `Plugin installed from ${url}`,
          main: 'index.js',
        };
        pluginCode = content;
      }

      await this.installPlugin(manifest, pluginCode, url, force);
    } catch (error) {
      throw new Error(`Failed to install plugin from URL: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async installFromFile(filePath: string, force: boolean = false): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      
      let manifest: PluginManifest;
      let pluginCode: string | null = null;
      let externalCodePath: string | null = null;

      // Determine file format based on extension
      if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
        const data = yaml.load(content) as any;
        if (!data.manifest) {
          throw new Error('Invalid YAML plugin file format. Missing manifest.');
        }
        manifest = data.manifest;
        
        // Check for inline code or external file reference
        if (data.code) {
          pluginCode = data.code;
        } else if (data.codeFile) {
          // External code file reference (relative to plugin file)
          externalCodePath = path.resolve(path.dirname(filePath), data.codeFile);
        } else {
          throw new Error('Plugin must specify either "code" (inline) or "codeFile" (external reference)');
        }
      } else {
        // Assume JSON
        const json = JSON.parse(content);
        if (!json.manifest) {
          throw new Error('Invalid JSON plugin file format. Missing manifest.');
        }
        manifest = json.manifest;
        
        // Check for inline code or external file reference
        if (json.code) {
          pluginCode = json.code;
        } else if (json.codeFile) {
          // External code file reference (relative to plugin file)
          externalCodePath = path.resolve(path.dirname(filePath), json.codeFile);
        } else {
          throw new Error('Plugin must specify either "code" (inline) or "codeFile" (external reference)');
        }
      }

      // If external file, read it
      if (externalCodePath) {
        try {
          pluginCode = await fs.readFile(externalCodePath, 'utf-8');
        } catch (error) {
          throw new Error(`Failed to read external code file ${externalCodePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (!pluginCode) {
        throw new Error('No plugin code found');
      }

      await this.installPlugin(manifest, pluginCode, filePath, force);
    } catch (error) {
      throw new Error(`Failed to install plugin from file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async installPlugin(manifest: PluginManifest, code: string, source: string, force: boolean = false): Promise<void> {
    const pluginPath = path.join(this.pluginDir, manifest.name);

    // Check if plugin already exists
    const exists = await fs.access(pluginPath).then(() => true).catch(() => false);
    if (exists) {
      if (force) {
        console.log(`Plugin ${manifest.name} already exists. Force flag detected, reinstalling...`);
        await this.uninstall(manifest.name);
      } else {
        throw new Error(`Plugin ${manifest.name} already exists. Uninstall it first.`);
      }
    }

    // Create plugin directory
    await fs.mkdir(pluginPath, { recursive: true });

    // Write manifest
    await fs.writeFile(
      path.join(pluginPath, 'plugin.json'),
      JSON.stringify(manifest, null, 2)
    );

    // Write plugin code
    await fs.writeFile(path.join(pluginPath, manifest.main), code);

    // Update metadata
    const metadata: PluginMetadata = {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      homepage: manifest.homepage,
      repository: manifest.repository,
      license: manifest.license,
      installDate: new Date().toISOString(),
      enabled: true,
      source,
    };

    await this.updateMetadata(manifest.name, metadata);

    // Load the plugin
    await this.loadPlugin(manifest.name, metadata);
  }

  async uninstall(pluginName: string): Promise<void> {
    const pluginPath = path.join(this.pluginDir, pluginName);

    // Remove from loaded plugins
    this.plugins.delete(pluginName);

    // Delete plugin directory
    await fs.rm(pluginPath, { recursive: true, force: true });

    // Remove from metadata
    await this.removeMetadata(pluginName);
  }

  async enable(pluginName: string): Promise<void> {
    const metadata = await this.getMetadata(pluginName);
    if (!metadata) {
      throw new Error(`Plugin ${pluginName} not found`);
    }

    metadata.enabled = true;
    await this.updateMetadata(pluginName, metadata);
    await this.loadPlugin(pluginName, metadata);
  }

  async disable(pluginName: string): Promise<void> {
    const metadata = await this.getMetadata(pluginName);
    if (!metadata) {
      throw new Error(`Plugin ${pluginName} not found`);
    }

    metadata.enabled = false;
    await this.updateMetadata(pluginName, metadata);
    this.plugins.delete(pluginName);
  }

  getLoadedPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  getAllTools(): Tool[] {
    const tools: Tool[] = [];
    for (const plugin of this.plugins.values()) {
      tools.push(...plugin.tools);
    }
    return tools;
  }

  async listInstalled(): Promise<PluginMetadata[]> {
    try {
      const metadataContent = await fs.readFile(this.metadataFile, 'utf-8');
      const allMetadata: Record<string, PluginMetadata> = JSON.parse(metadataContent);
      return Object.values(allMetadata);
    } catch (error) {
      return [];
    }
  }

  private async getMetadata(pluginName: string): Promise<PluginMetadata | null> {
    try {
      const metadataContent = await fs.readFile(this.metadataFile, 'utf-8');
      const allMetadata: Record<string, PluginMetadata> = JSON.parse(metadataContent);
      return allMetadata[pluginName] || null;
    } catch (error) {
      return null;
    }
  }

  private async updateMetadata(pluginName: string, metadata: PluginMetadata): Promise<void> {
    let allMetadata: Record<string, PluginMetadata> = {};

    try {
      const content = await fs.readFile(this.metadataFile, 'utf-8');
      allMetadata = JSON.parse(content);
    } catch (error) {
      // File doesn't exist yet
    }

    allMetadata[pluginName] = metadata;
    await fs.writeFile(this.metadataFile, JSON.stringify(allMetadata, null, 2));
  }

  private async removeMetadata(pluginName: string): Promise<void> {
    try {
      const content = await fs.readFile(this.metadataFile, 'utf-8');
      const allMetadata: Record<string, PluginMetadata> = JSON.parse(content);
      delete allMetadata[pluginName];
      await fs.writeFile(this.metadataFile, JSON.stringify(allMetadata, null, 2));
    } catch (error) {
      // Ignore errors
    }
  }

  private extractPluginNameFromURL(url: string): string {
    // Extract filename from URL and remove extension
    const urlPath = new URL(url).pathname;
    const filename = path.basename(urlPath);
    return filename.replace(/\.(js|ts|json)$/, '');
  }
}
