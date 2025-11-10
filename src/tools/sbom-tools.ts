/**
 * SBOM Analysis Tools
 * 
 * Tools for analyzing Software Bill of Materials (SBOM) files,
 * extracting package URLs (PURLs), and checking package information.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { Tool } from '../plugins.js';

const execAsync = promisify(exec);

// Cache directory for GitHub API responses
const CACHE_DIR = path.join(os.homedir(), '.kitty', 'cache', 'github');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Initialize cache directory
 */
async function initCache(): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch (error) {
    // Ignore if already exists
  }
}

/**
 * Get cached GitHub data for a repository
 */
async function getCachedRepo(owner: string, repo: string): Promise<any | null> {
  try {
    const cacheKey = `${owner}__${repo}.json`;
    const cachePath = path.join(CACHE_DIR, cacheKey);

    const stat = await fs.stat(cachePath);
    const age = Date.now() - stat.mtimeMs;

    // Check if cache is still valid
    if (age > CACHE_TTL_MS) {
      console.log(`   ⏰ Cache expired for ${owner}/${repo} (${Math.round(age / 1000 / 60 / 60)}h old)`);
      return null;
    }

    const cached = await fs.readFile(cachePath, 'utf-8');
    const data = JSON.parse(cached);
    console.log(`   💾 Cache hit: ${owner}/${repo}`);
    return data;
  } catch (error) {
    // Cache miss
    return null;
  }
}

/**
 * Save GitHub data to cache
 */
async function setCachedRepo(owner: string, repo: string, data: any): Promise<void> {
  try {
    await initCache();
    const cacheKey = `${owner}__${repo}.json`;
    const cachePath = path.join(CACHE_DIR, cacheKey);
    await fs.writeFile(cachePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`   💾 Cached: ${owner}/${repo}`);
  } catch (error) {
    console.error(`   ⚠️  Failed to cache ${owner}/${repo}:`, error);
  }
}

const KNOWN_PURL_TYPES: Record<string, string> = {
  apk: 'Alpine APK',
  bitbucket: 'Bitbucket repository',
  cargo: 'Rust crates.io',
  composer: 'PHP Composer',
  conan: 'C/C++ Conan package',
  deb: 'Debian package',
  gem: 'RubyGems package',
  generic: 'Generic artifact',
  github: 'GitHub repository',
  githubactions: 'GitHub Actions workflow',
  golang: 'Go module',
  hex: 'Erlang/Elixir Hex package',
  maven: 'Maven Central / Java',
  npm: 'JavaScript npm package',
  nuget: '.NET NuGet package',
  pypi: 'Python PyPI package',
  rpm: 'RedHat RPM',
  swift: 'Swift package',
  docker: 'Container image',
};

const PURL_REGEX = /pkg:[a-z0-9.+-]+\/[^\s"'<>\]}]+/gi;

function cleanPurlMatch(match: string): string | null {
  if (!match) return null;
  return match
    .trim()
    .replace(/[,)\]\}">]+$/, '');
}

function dissectPurl(purl: string) {
  const purlRegex = /^pkg:([^\/]+)\/(?:([^\/@]+)\/)?([^@]+?)(?:@([^?#]+))?(?:\?([^#]+))?(?:#(.+))?$/;
  const match = purl.trim().match(purlRegex);

  if (!match) {
    throw new Error('Invalid PURL format');
  }

  const [, type, namespace, name, version, qualifiers, subpath] = match;

  return {
    type,
    namespace: namespace || null,
    name,
    version: version || null,
    qualifiers: qualifiers ? Object.fromEntries(new URLSearchParams(qualifiers)) : {},
    subpath: subpath || null,
    ecosystem: type,
    type_label: KNOWN_PURL_TYPES[type] || 'unknown',
  };
}

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
      const parsed = dissectPurl(params.purl);
      return JSON.stringify(parsed, null, 2);
    } catch (error: any) {
      return `Error parsing PURL: ${error.message}`;
    }
  },
};

/**
 * Scan SBOM file for PURLs using regex
 */
const scanSBOMPURLs: Tool = {
  name: 'scan_sbom_purls',
  description: 'Scan an SBOM file for Package URLs (PURLs) without sending the entire file to the AI model',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Path to the SBOM file (JSON, XML, SPDX tag/value, etc.)',
      },
      unique_only: {
        type: 'boolean',
        description: 'Return only unique PURLs (default: true)',
      },
      include_metadata: {
        type: 'boolean',
        description: 'Include parsed metadata (name, version, ecosystem) for each match (default: true)',
      },
    },
    required: ['file_path'],
  },
  execute: async (params: { file_path: string; unique_only?: boolean; include_metadata?: boolean }) => {
    try {
      const content = await readFile(params.file_path, 'utf-8');
      const matches = content.match(PURL_REGEX) || [];
      const uniqueOnly = params.unique_only !== false;
      const includeMetadata = params.include_metadata !== false;
      const seen = new Set<string>();
      const results: any[] = [];

      for (const match of matches) {
        const cleaned = cleanPurlMatch(match);
        if (!cleaned) continue;
        if (uniqueOnly && seen.has(cleaned)) continue;
        seen.add(cleaned);

        if (includeMetadata) {
          try {
            const parsed = dissectPurl(cleaned);
            results.push({
              purl: cleaned,
              name: parsed.name,
              version: parsed.version,
              ecosystem: parsed.ecosystem,
              namespace: parsed.namespace,
              qualifiers: parsed.qualifiers,
              type_label: parsed.type_label,
            });
          } catch (error: any) {
            results.push({
              purl: cleaned,
              error: error.message,
            });
          }
        } else {
          results.push(cleaned);
        }
      }

      return JSON.stringify({
        total_matches: matches.length,
        unique_purls: seen.size,
        results,
      }, null, 2);
    } catch (error: any) {
      return `Error scanning SBOM: ${error.message}`;
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

/**
 * Batch analyze GitHub packages from SBOM
 */
const batchAnalyzeGitHubPackages: Tool = {
  name: 'batch_analyze_github_packages',
  description: 'Efficiently analyze multiple GitHub packages from SBOM in batches',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Path to SBOM file',
      },
      batch_size: {
        type: 'number',
        description: 'Number of packages to analyze per batch (default: 20)',
      },
      offset: {
        type: 'number',
        description: 'Starting offset for batch processing (default: 0)',
      },
    },
    required: ['file_path'],
  },
  execute: async (params: { file_path: string; batch_size?: number; offset?: number }) => {
    try {
      const batchSize = params.batch_size || 20;
      const offset = params.offset || 0;

      // Get GitHub token from environment if available
      const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Kitty-AI-Agent'
      };

      if (githubToken) {
        headers['Authorization'] = `Bearer ${githubToken}`;
        console.log('   Using GitHub token for authentication');
      } else {
        console.log('   ⚠️  No GITHUB_TOKEN found - using unauthenticated requests (60 req/hour limit)');
      }

      // Extract GitHub PURLs from SBOM
      const { stdout } = await execAsync(`grep -o 'pkg:golang/github.com/[^"]*' "${params.file_path}"`);
      const purls = stdout.trim().split('\n').filter(Boolean);

      // Also get overall PURL statistics for context
      let purlStats: Record<string, number> = {};
      try {
        const { stdout: allPurls } = await execAsync(`grep -o 'pkg:[^"]*' "${params.file_path}"`);
        const allPurlsList = allPurls.trim().split('\n').filter(Boolean);

        allPurlsList.forEach(purl => {
          const typeMatch = purl.match(/^pkg:([^\/]+)\//);
          if (typeMatch) {
            const type = typeMatch[1];
            purlStats[type] = (purlStats[type] || 0) + 1;
          }
        });
      } catch (err) {
        // Ignore if grep fails
      }

      if (purls.length === 0) {
        return JSON.stringify({
          total_packages: 0,
          analyzed_count: 0,
          packages: [],
          has_more: false,
        }, null, 2);
      }

      // Get batch of PURLs
      const batchPurls = purls.slice(offset, offset + batchSize);
      const packages: any[] = [];
      const errors: string[] = [];
      let cacheHits = 0;
      let cacheMisses = 0;

      // Parse each PURL and fetch GitHub data
      for (const purl of batchPurls) {
        try {
          // Parse PURL: pkg:golang/github.com/owner/repo@version
          const match = purl.match(/pkg:golang\/github\.com\/([^\/]+)\/([^@]+)(?:@(.+))?/);
          if (!match) continue;

          let [, owner, rawRepo, version] = match;

          // Strip Go module version suffixes (e.g., /v2, /v3, /v4)
          // These are semantic versioning paths, not part of the actual repo name
          const repo = rawRepo.replace(/\/v\d+$/, '');

          console.log(`   Parsing: ${owner}/${rawRepo} → ${owner}/${repo}`);

          // Check cache first
          const cached = await getCachedRepo(owner, repo);
          if (cached) {
            cacheHits++;
            packages.push({
              ...cached,
              purl,
              version,
              cached: true,
            });
            continue;
          }

          cacheMisses++;

          // Fetch from GitHub API
          try {
            const [repoResponse, commitsResponse] = await Promise.all([
              fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers }),
              fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`, { headers })
            ]);

            // Check for rate limiting
            if (repoResponse.status === 403 || commitsResponse.status === 403) {
              const rateLimitReset = repoResponse.headers.get('x-ratelimit-reset');
              const resetTime = rateLimitReset ? new Date(parseInt(rateLimitReset) * 1000).toLocaleTimeString() : 'unknown';
              const errorMsg = `Rate limited by GitHub API. Reset at: ${resetTime}. Set GITHUB_TOKEN env var for higher limits.`;
              errors.push(errorMsg);

              packages.push({
                purl,
                owner,
                repo,
                version,
                github_url: `https://github.com/${owner}/${repo}`,
                error: 'Rate limited',
                status: 'unknown',
              });
              continue;
            }

            if (repoResponse.ok && commitsResponse.ok) {
              const repoData = await repoResponse.json();
              const commitsData = await commitsResponse.json();
              const lastCommit = commitsData[0];

              const lastCommitDate = lastCommit?.commit?.author?.date;
              const monthsSinceLastCommit = lastCommitDate
                ? (Date.now() - new Date(lastCommitDate).getTime()) / (1000 * 60 * 60 * 24 * 30)
                : Infinity;

              let status = 'maintained';
              if (repoData.archived || repoData.disabled) {
                status = 'archived';
              } else if (monthsSinceLastCommit > 12) {
                status = 'unmaintained';
              } else if (monthsSinceLastCommit > 6) {
                status = 'stale';
              }

              const packageData = {
                owner,
                repo,
                github_url: `https://github.com/${owner}/${repo}`,
                stars: repoData.stargazers_count,
                forks: repoData.forks_count,
                open_issues: repoData.open_issues_count,
                license: repoData.license?.spdx_id || 'None',
                archived: repoData.archived,
                last_commit_sha: lastCommit?.sha?.substring(0, 7),
                last_commit_date: lastCommitDate,
                months_since_last_commit: Math.round(monthsSinceLastCommit * 10) / 10,
                status,
              };

              // Cache successful response
              await setCachedRepo(owner, repo, packageData);

              packages.push({
                purl,
                version,
                ...packageData,
              });
            } else {
              const errorDetail = `HTTP ${repoResponse.status}/${commitsResponse.status}`;
              packages.push({
                purl,
                owner,
                repo,
                version,
                github_url: `https://github.com/${owner}/${repo}`,
                error: `Failed to fetch from GitHub API: ${errorDetail}`,
                status: 'unknown',
              });
            }
          } catch (apiError: any) {
            packages.push({
              purl,
              owner,
              repo,
              version,
              github_url: `https://github.com/${owner}/${repo}`,
              error: `API request failed: ${apiError.message}`,
              status: 'unknown',
            });
          }

          // Rate limiting: delay between requests (smaller delay with token)
          // Skip delay if using cache
          if (cacheMisses > 0) {
            await new Promise(resolve => setTimeout(resolve, githubToken ? 100 : 1000));
          }
        } catch (parseError) {
          // Skip invalid PURLs
          continue;
        }
      }

      console.log(`   📊 Cache stats: ${cacheHits} hits, ${cacheMisses} misses (${Math.round(cacheHits / (cacheHits + cacheMisses) * 100)}% hit rate)`);

      return JSON.stringify({
        total_packages: purls.length,
        analyzed_count: packages.length,
        offset,
        next_offset: offset + batchSize,
        has_more: offset + batchSize < purls.length,
        packages,
        errors: errors.length > 0 ? errors : undefined,
        purl_stats: Object.keys(purlStats).length > 0 ? purlStats : undefined,
        cache_stats: {
          hits: cacheHits,
          misses: cacheMisses,
          hit_rate_percent: cacheHits + cacheMisses > 0 ? Math.round(cacheHits / (cacheHits + cacheMisses) * 100) : 0,
        },
        summary: {
          maintained: packages.filter(p => p.status === 'maintained').length,
          stale: packages.filter(p => p.status === 'stale').length,
          unmaintained: packages.filter(p => p.status === 'unmaintained').length,
          archived: packages.filter(p => p.status === 'archived').length,
          unknown: packages.filter(p => p.status === 'unknown').length,
        }
      }, null, 2);
    } catch (error: any) {
      return JSON.stringify({
        error: `Batch analysis failed: ${error.message}`,
        total_packages: 0,
        analyzed_count: 0,
        packages: [],
        has_more: false,
      }, null, 2);
    }
  },
};

export const tools: Tool[] = [
  parseSBOM,
  parsePURL,
  scanSBOMPURLs,
  fetchPackageMetadata,
  checkRepoMaintenance,
  executeCommand,
  batchAnalyzeGitHubPackages,
];
