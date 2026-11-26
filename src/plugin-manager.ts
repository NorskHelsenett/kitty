import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { pathToFileURL } from 'url';
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

/** What the user is shown before plugin code is written to disk and executed. */
export interface PluginInstallSummary {
  manifest: PluginManifest;
  source: string;
  codeBytes: number;
  codePreview: string;
}

/** Return true to proceed with the install. */
export type PluginInstallConfirm = (summary: PluginInstallSummary) => Promise<boolean>;

// Plugin names become directory names under the plugin dir
const PLUGIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_PLUGIN_DOWNLOAD_BYTES = 5 * 1024 * 1024;

export function assertValidPluginName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !PLUGIN_NAME.test(name) || name.includes('..') || name === 'metadata.json') {
    throw new Error(`Invalid plugin name ${JSON.stringify(name)}: use letters, digits, ".", "_" and "-" only`);
  }
}

/** Resolve `relative` inside `baseDir`, refusing absolute paths and anything that escapes it. */
function resolveInside(baseDir: string, relative: unknown, what: string): string {
  if (typeof relative !== 'string' || relative.length === 0 || path.isAbsolute(relative)) {
    throw new Error(`Invalid ${what} ${JSON.stringify(relative)}: must be a relative path`);
  }
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, relative);
  if (resolved === base || !resolved.startsWith(base + path.sep)) {
    throw new Error(`Invalid ${what} ${JSON.stringify(relative)}: must stay inside ${base}`);
  }
  return resolved;
}

function validateManifest(manifest: any): PluginManifest {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Invalid plugin manifest');
  }
  assertValidPluginName(manifest.name);
  if (typeof manifest.main !== 'string') {
    throw new Error('Invalid plugin manifest: "main" must be a string');
  }
  // The real plugin dir is checked again on write and load
  const mainSegments = manifest.main.split(/[\\/]/);
  if (path.isAbsolute(manifest.main) || mainSegments.includes('..') || manifest.main.trim() === '') {
    throw new Error(`Invalid manifest.main ${JSON.stringify(manifest.main)}: must be a relative path inside the plugin`);
  }
  return manifest as PluginManifest;
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

  /** Path of a plugin's directory, guaranteed to be a direct child of the plugin dir. */
  private getPluginPath(pluginName: string): string {
    assertValidPluginName(pluginName);
    const pluginPath = resolveInside(this.pluginDir, pluginName, 'plugin name');
    if (path.dirname(pluginPath) !== path.resolve(this.pluginDir)) {
      throw new Error(`Invalid plugin name ${JSON.stringify(pluginName)}`);
    }
    return pluginPath;
  }

  private async loadPlugin(pluginName: string, metadata: PluginMetadata): Promise<void> {
    const pluginPath = this.getPluginPath(pluginName);
    
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

      // Load the main file. Plugins are trusted code: this import runs with
      // the full privileges of the kitty process, so installs are confirmed.
      const mainPath = resolveInside(pluginPath, manifest.main, 'manifest.main');
      const pluginModule = await import(pathToFileURL(mainPath).href);

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

  async installFromURL(url: string, force: boolean = false, confirm?: PluginInstallConfirm): Promise<void> {
    try {
      // Plain HTTP lets anyone on the network path swap the code we execute
      if (new URL(url).protocol !== 'https:') {
        throw new Error('Only https:// URLs are supported for plugin installs');
      }

      // Download the plugin file
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download plugin: ${response.statusText}`);
      }

      const declaredLength = Number(response.headers.get('content-length') || 0);
      if (declaredLength > MAX_PLUGIN_DOWNLOAD_BYTES) {
        throw new Error(`Plugin is too large (${declaredLength} bytes, limit ${MAX_PLUGIN_DOWNLOAD_BYTES})`);
      }
      const content = await response.text();
      if (content.length > MAX_PLUGIN_DOWNLOAD_BYTES) {
        throw new Error(`Plugin is too large (limit ${MAX_PLUGIN_DOWNLOAD_BYTES} bytes)`);
      }

      // Decide the format first; validation errors below must not be mistaken
      // for "not JSON" and fall through to the raw-code path.
      let json: any;
      let isJson = false;
      try {
        json = JSON.parse(content);
        isJson = true;
      } catch {
        isJson = false;
      }

      let manifest: PluginManifest;
      let pluginCode: string;

      if (isJson) {
        if (json && typeof json === 'object' && json.manifest && typeof json.code === 'string') {
          manifest = json.manifest;
          pluginCode = json.code;
        } else if (json && typeof json === 'object' && json.name && json.version && json.main) {
          throw new Error('Multi-file plugins not yet supported for URL installs. Use single-file format with manifest and code.');
        } else {
          throw new Error('Invalid plugin format: expected {"manifest": {...}, "code": "..."} or JavaScript source');
        }
      } else {
        // Not JSON, treat as direct JavaScript code with a default manifest
        manifest = {
          name: this.extractPluginNameFromURL(url),
          version: '1.0.0',
          description: `Plugin installed from ${url}`,
          main: 'index.js',
        };
        pluginCode = content;
      }

      await this.installPlugin(manifest, pluginCode, url, force, confirm);
    } catch (error) {
      throw new Error(`Failed to install plugin from URL: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async installFromFile(filePath: string, force: boolean = false, confirm?: PluginInstallConfirm): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      
      let manifest: PluginManifest;
      let pluginCode: string | null = null;
      let externalCodePath: string | null = null;

      // Determine file format based on extension
      if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
        const data = yaml.load(content) as any;
        if (!data || !data.manifest) {
          throw new Error('Invalid YAML plugin file format. Missing manifest.');
        }
        manifest = data.manifest;
        
        // Check for inline code or external file reference
        if (data.code) {
          pluginCode = data.code;
        } else if (data.codeFile) {
          // External code file reference, must stay inside the plugin file's directory
          externalCodePath = resolveInside(path.dirname(filePath), data.codeFile, 'codeFile');
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
          // External code file reference, must stay inside the plugin file's directory
          externalCodePath = resolveInside(path.dirname(filePath), json.codeFile, 'codeFile');
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

      await this.installPlugin(manifest, pluginCode, filePath, force, confirm);
    } catch (error) {
      throw new Error(`Failed to install plugin from file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async installPlugin(
    rawManifest: PluginManifest,
    code: string,
    source: string,
    force: boolean = false,
    confirm?: PluginInstallConfirm
  ): Promise<void> {
    const manifest = validateManifest(rawManifest);
    const pluginPath = this.getPluginPath(manifest.name);
    const mainPath = resolveInside(pluginPath, manifest.main, 'manifest.main');

    if (confirm) {
      const approved = await confirm({
        manifest,
        source,
        codeBytes: Buffer.byteLength(code, 'utf-8'),
        codePreview: code.split('\n').slice(0, 15).join('\n'),
      });
      if (!approved) {
        throw new Error('Installation cancelled');
      }
    }

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
    await fs.mkdir(path.dirname(mainPath), { recursive: true });
    await fs.writeFile(mainPath, code);

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
    // Validated: the recursive delete below must only ever hit a plugin directory
    const pluginPath = this.getPluginPath(pluginName);

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

  getPlugin(pluginName: string): Plugin | undefined {
    return this.plugins.get(pluginName);
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
    const name = filename.replace(/\.(js|mjs|ts|json)$/, '');
    assertValidPluginName(name);
    return name;
  }
}
