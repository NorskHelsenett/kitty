/**
 * SBOM Analysis Tools
 * 
 * Tools for analyzing Software Bill of Materials (SBOM) files,
 * extracting package URLs (PURLs), and checking package information.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { Tool } from '../plugins.js';

const execAsync = promisify(exec);

/**
 * Parse SBOM file and extract packages
 */
const parseSBOM: Tool = {
  name: 'parse_sbom',
  description: 'Parse SBOM files (CycloneDX or SPDX format) and extract package information including PURLs',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Path to the SBOM file (JSON or XML)',
      },
      format: {
        type: 'string',
        enum: ['cyclonedx', 'spdx', 'auto'],
        description: 'SBOM format (auto-detect by default)',
      },
    },
    required: ['file_path'],
  },
  execute: async (params: { file_path: string; format?: string }) => {
    try {
      const content = await readFile(params.file_path, 'utf-8');
      const data = JSON.parse(content);
      const packages: any[] = [];

      // Auto-detect format
      let format = params.format || 'auto';
      if (format === 'auto') {
        if (data.bomFormat === 'CycloneDX') {
          format = 'cyclonedx';
        } else if (data.SPDXID || data.spdxVersion) {
          format = 'spdx';
        }
      }

      // Parse based on format
      if (format === 'cyclonedx') {
        const components = data.components || [];
        for (const comp of components) {
          packages.push({
            name: comp.name,
            version: comp.version,
            purl: comp.purl || '',
            ecosystem: comp.purl ? comp.purl.split(':')[1] : 'unknown',
            license: comp.licenses?.[0]?.license?.id || comp.licenses?.[0]?.license?.name || 'unknown',
          });
        }
      } else if (format === 'spdx') {
        const pkgs = data.packages || [];
        for (const pkg of pkgs) {
          // Extract ecosystem from external refs
          let purl = '';
          let ecosystem = 'unknown';
          
          if (pkg.externalRefs) {
            const purlRef = pkg.externalRefs.find((ref: any) => ref.referenceType === 'purl');
            if (purlRef) {
              purl = purlRef.referenceLocator;
              ecosystem = purl.split(':')[1];
            }
          }

          packages.push({
            name: pkg.name,
            version: pkg.versionInfo || 'unknown',
            purl,
            ecosystem,
            license: pkg.licenseConcluded || 'unknown',
          });
        }
      }

      return JSON.stringify({
        format,
        total_packages: packages.length,
        packages,
      }, null, 2);
    } catch (error: any) {
      return `Error parsing SBOM: ${error.message}`;
    }
  },
};

/**
 * Extract PURL components
 */
const parsePURL: Tool = {
  name: 'parse_purl',
  description: 'Parse a Package URL (PURL) and extract its components (type, namespace, name, version, etc.)',
  inputSchema: {
    type: 'object',
    properties: {
      purl: {
        type: 'string',
        description: 'Package URL to parse (e.g., pkg:npm/express@4.18.2)',
      },
    },
    required: ['purl'],
  },
  execute: async (params: { purl: string }) => {
    try {
      // PURL format: pkg:type/namespace/name@version?qualifiers#subpath
      const purlRegex = /^pkg:([^\/]+)\/(?:([^\/]+)\/)?([^@]+)(?:@([^?#]+))?(?:\?([^#]+))?(?:#(.+))?$/;
      const match = params.purl.match(purlRegex);

      if (!match) {
        return `Error: Invalid PURL format`;
      }

      const [, type, namespace, name, version, qualifiers, subpath] = match;

      const result = {
        type,
        namespace: namespace || null,
        name,
        version: version || null,
        qualifiers: qualifiers ? Object.fromEntries(new URLSearchParams(qualifiers)) : {},
        subpath: subpath || null,
        ecosystem: type,
      };

      return JSON.stringify(result, null, 2);
    } catch (error: any) {
      return `Error parsing PURL: ${error.message}`;
    }
  },
};

/**
 * Fetch package metadata from registry
 */
const fetchPackageMetadata: Tool = {
  name: 'fetch_package_metadata',
  description: 'Fetch package metadata from various package registries (npm, PyPI, crates.io, etc.)',
  inputSchema: {
    type: 'object',
    properties: {
      ecosystem: {
        type: 'string',
        enum: ['npm', 'pypi', 'cargo', 'maven', 'nuget', 'go'],
        description: 'Package ecosystem',
      },
      package_name: {
        type: 'string',
        description: 'Package name',
      },
    },
    required: ['ecosystem', 'package_name'],
  },
  execute: async (params: { ecosystem: string; package_name: string }) => {
    try {
      let url = '';
      
      switch (params.ecosystem) {
        case 'npm':
          url = `https://registry.npmjs.org/${params.package_name}`;
          break;
        case 'pypi':
          url = `https://pypi.org/pypi/${params.package_name}/json`;
          break;
        case 'cargo':
          url = `https://crates.io/api/v1/crates/${params.package_name}`;
          break;
        case 'maven':
          // Maven Central search API
          url = `https://search.maven.org/solrsearch/select?q=g:"${params.package_name.split(':')[0]}"`;
          break;
        case 'go':
          url = `https://proxy.golang.org/${params.package_name}/@latest`;
          break;
        default:
          return `Error: Unsupported ecosystem ${params.ecosystem}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        return `Error: Failed to fetch metadata (${response.status} ${response.statusText})`;
      }

      const data: any = await response.json();
      
      // Extract common fields based on ecosystem
      let metadata: any = { ecosystem: params.ecosystem, name: params.package_name };

      if (params.ecosystem === 'npm') {
        metadata.latest_version = data['dist-tags']?.latest;
        metadata.license = data.license;
        metadata.repository = data.repository?.url;
        metadata.homepage = data.homepage;
        metadata.description = data.description;
      } else if (params.ecosystem === 'pypi') {
        metadata.latest_version = data.info.version;
        metadata.license = data.info.license;
        metadata.repository = data.info.project_urls?.Source || data.info.project_urls?.Repository;
        metadata.homepage = data.info.home_page;
        metadata.description = data.info.summary;
      } else if (params.ecosystem === 'cargo') {
        metadata.latest_version = data.crate.max_version;
        metadata.repository = data.crate.repository;
        metadata.homepage = data.crate.homepage;
        metadata.description = data.crate.description;
      }

      return JSON.stringify(metadata, null, 2);
    } catch (error: any) {
      return `Error fetching package metadata: ${error.message}`;
    }
  },
};

/**
 * Check repository maintenance status
 */
const checkRepoMaintenance: Tool = {
  name: 'check_repo_maintenance',
  description: 'Check if a Git repository is actively maintained by analyzing recent commits and activity',
  inputSchema: {
    type: 'object',
    properties: {
      repo_url: {
        type: 'string',
        description: 'Git repository URL',
      },
      months_threshold: {
        type: 'number',
        description: 'Months of inactivity to consider unmaintained (default: 12)',
      },
    },
    required: ['repo_url'],
  },
  execute: async (params: { repo_url: string; months_threshold?: number }) => {
    try {
      const threshold = params.months_threshold || 12;
      
      // Get last commit date using git ls-remote
      const { stdout } = await execAsync(`git ls-remote ${params.repo_url} HEAD`);
      
      if (!stdout) {
        return JSON.stringify({
          status: 'error',
          message: 'Unable to access repository',
          maintained: false,
        });
      }

      // For more detailed analysis, we'd need to clone, but we can check if repo exists
      const result = {
        status: 'accessible',
        repo_url: params.repo_url,
        accessible: true,
        note: `Repository is accessible. For detailed commit analysis, use git log after cloning.`,
        recommendation: `Clone repo and check: git log --since="${threshold} months ago" --oneline`,
      };

      return JSON.stringify(result, null, 2);
    } catch (error: any) {
      return JSON.stringify({
        status: 'inaccessible',
        repo_url: params.repo_url,
        accessible: false,
        error: error.message,
        maintained: false,
      }, null, 2);
    }
  },
};

/**
 * Execute shell command (for git operations, etc.)
 */
const executeCommand: Tool = {
  name: 'execute_command',
  description: 'Execute a shell command (useful for git clone, git log, etc.)',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute',
      },
      cwd: {
        type: 'string',
        description: 'Working directory (optional)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
      },
    },
    required: ['command'],
  },
  execute: async (params: { command: string; cwd?: string; timeout?: number }) => {
    try {
      const options: any = {
        timeout: params.timeout || 30000,
        maxBuffer: 1024 * 1024 * 10, // 10MB
      };
      
      if (params.cwd) {
        options.cwd = params.cwd;
      }

      const { stdout, stderr } = await execAsync(params.command, options);
      
      return JSON.stringify({
        success: true,
        stdout: String(stdout).trim(),
        stderr: String(stderr).trim(),
      }, null, 2);
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        stdout: error.stdout ? String(error.stdout).trim() : '',
        stderr: error.stderr ? String(error.stderr).trim() : '',
      }, null, 2);
    }
  },
};

export const tools: Tool[] = [
  parseSBOM,
  parsePURL,
  fetchPackageMetadata,
  checkRepoMaintenance,
  executeCommand,
];
