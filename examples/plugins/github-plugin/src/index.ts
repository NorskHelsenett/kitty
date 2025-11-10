/**
 * GitHub Plugin - TypeScript Source
 * 
 * Build with: bun run build
 * This generates dist/index.js which is referenced in the plugin manifest
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

interface Tool {
  name: string;
  description: string;
  inputSchema: any;
  execute: (params: any) => Promise<string>;
}

const GITHUB_ACTIVITY_DIR = path.join(os.homedir(), '.kitty', 'cache', 'github', 'activity');

async function ensureCacheDir(): Promise<void> {
  await fs.mkdir(GITHUB_ACTIVITY_DIR, { recursive: true });
}

function sanitizeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getActivityCachePath(owner: string, repo: string): string {
  const safeOwner = sanitizeSegment(owner);
  const safeRepo = sanitizeSegment(repo);
  return path.join(GITHUB_ACTIVITY_DIR, `${safeOwner}__${safeRepo}.json`);
}

async function cacheGitHubActivity(owner: string, repo: string, payload: any): Promise<void> {
  try {
    await ensureCacheDir();
    const cachePath = getActivityCachePath(owner, repo);
    await fs.writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to cache GitHub activity data', error);
  }
}

function buildGitHubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'Kitty-AI-Agent',
  };

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

function githubApiErrorMessage(response: Response, label: string): string {
  return `GitHub ${label} request failed with ${response.status} ${response.statusText}`;
}

const getRepoInfo: Tool = {
  name: 'github_repo_info',
  description: 'Get information about a GitHub repository',
  inputSchema: {
    type: 'object',
    properties: {
      owner: {
        type: 'string',
        description: 'Repository owner (username or organization)'
      },
      repo: {
        type: 'string',
        description: 'Repository name'
      }
    },
    required: ['owner', 'repo']
  },
  execute: async (params: { owner: string; repo: string }): Promise<string> => {
    try {
      const url = `https://api.github.com/repos/${params.owner}/${params.repo}`;
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Kitty-AI-Agent'
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          return `Repository ${params.owner}/${params.repo} not found`;
        }
        return `Error: ${response.status} ${response.statusText}`;
      }

      const data: any = await response.json();

      return JSON.stringify({
        name: data.name,
        full_name: data.full_name,
        description: data.description,
        stars: data.stargazers_count,
        forks: data.forks_count,
        open_issues: data.open_issues_count,
        language: data.language,
        license: data.license?.spdx_id || 'None',
        created_at: data.created_at,
        updated_at: data.updated_at,
        homepage: data.homepage,
        archived: data.archived,
        disabled: data.disabled,
      }, null, 2);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const listRepoCommits: Tool = {
  name: 'github_list_commits',
  description: 'List recent commits from a GitHub repository',
  inputSchema: {
    type: 'object',
    properties: {
      owner: {
        type: 'string',
        description: 'Repository owner'
      },
      repo: {
        type: 'string',
        description: 'Repository name'
      },
      limit: {
        type: 'number',
        description: 'Number of commits to fetch (default: 10, max: 100)'
      }
    },
    required: ['owner', 'repo']
  },
  execute: async (params: { owner: string; repo: string; limit?: number }): Promise<string> => {
    try {
      const limit = Math.min(params.limit || 10, 100);
      const url = `https://api.github.com/repos/${params.owner}/${params.repo}/commits?per_page=${limit}`;
      
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Kitty-AI-Agent'
        }
      });

      if (!response.ok) {
        return `Error: ${response.status} ${response.statusText}`;
      }

      const commits: any[] = await response.json();

      const commitList = commits.map(commit => ({
        sha: commit.sha.substring(0, 7),
        message: commit.commit.message.split('\n')[0],
        author: commit.commit.author.name,
        date: commit.commit.author.date,
      }));

      return JSON.stringify(commitList, null, 2);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const checkRepoMaintenance: Tool = {
  name: 'github_check_maintenance',
  description: 'Check if a GitHub repository appears to be actively maintained',
  inputSchema: {
    type: 'object',
    properties: {
      owner: {
        type: 'string',
        description: 'Repository owner'
      },
      repo: {
        type: 'string',
        description: 'Repository name'
      }
    },
    required: ['owner', 'repo']
  },
  execute: async (params: { owner: string; repo: string }): Promise<string> => {
    try {
      // Get repo info and recent commits
      const [repoResponse, commitsResponse] = await Promise.all([
        fetch(`https://api.github.com/repos/${params.owner}/${params.repo}`, {
          headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Kitty-AI-Agent' }
        }),
        fetch(`https://api.github.com/repos/${params.owner}/${params.repo}/commits?per_page=1`, {
          headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Kitty-AI-Agent' }
        })
      ]);

      if (!repoResponse.ok || !commitsResponse.ok) {
        return 'Error: Unable to fetch repository information';
      }

      const repo: any = await repoResponse.json();
      const commits: any[] = await commitsResponse.json();

      const lastCommit = commits[0];
      const lastCommitDate = lastCommit?.commit?.author?.date;
      const lastCommitSha = lastCommit?.sha;
      const lastCommitMessage = lastCommit?.commit?.message?.split('\n')[0];
      const monthsSinceLastCommit = lastCommitDate
        ? (Date.now() - new Date(lastCommitDate).getTime()) / (1000 * 60 * 60 * 24 * 30)
        : Infinity;

      const isArchived = repo.archived;
      const isDisabled = repo.disabled;
      const hasRecentActivity = monthsSinceLastCommit < 6;

      let status = 'maintained';
      if (isArchived || isDisabled) {
        status = 'archived';
      } else if (monthsSinceLastCommit > 12) {
        status = 'unmaintained';
      } else if (monthsSinceLastCommit > 6) {
        status = 'stale';
      }

      return JSON.stringify({
        repository: `${params.owner}/${params.repo}`,
        status,
        archived: isArchived,
        disabled: isDisabled,
        last_commit_date: lastCommitDate,
        last_commit_sha: lastCommitSha,
        last_commit_sha_short: lastCommitSha?.substring(0, 7),
        last_commit_message: lastCommitMessage,
        months_since_last_commit: Math.round(monthsSinceLastCommit * 10) / 10,
        open_issues: repo.open_issues_count,
        recommendation: status === 'maintained'
          ? 'Repository appears actively maintained'
          : status === 'archived'
          ? 'Repository is archived and no longer maintained'
          : 'Repository may not be actively maintained - use with caution'
      }, null, 2);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

const getRepoActivity: Tool = {
  name: 'github_repo_activity',
  description: 'Fetch latest pull requests, issues, and releases, cache full responses, and summarize activity',
  inputSchema: {
    type: 'object',
    properties: {
      owner: {
        type: 'string',
        description: 'Repository owner (username or organization)'
      },
      repo: {
        type: 'string',
        description: 'Repository name'
      }
    },
    required: ['owner', 'repo']
  },
  execute: async (params: { owner: string; repo: string }): Promise<string> => {
    try {
      const headers = buildGitHubHeaders();
      const baseUrl = `https://api.github.com/repos/${params.owner}/${params.repo}`;

      const pullsPromise = fetch(`${baseUrl}/pulls?state=all&sort=updated&direction=desc&per_page=10`, { headers });
      const issuesPromise = fetch(`${baseUrl}/issues?state=all&sort=updated&direction=desc&per_page=100`, { headers });
      const releasesPromise = fetch(`${baseUrl}/releases?per_page=10`, { headers });

      const [pullsResponse, issuesResponse, releasesResponse] = await Promise.all([
        pullsPromise,
        issuesPromise,
        releasesPromise
      ]);

      if (!pullsResponse.ok) {
        return `Error: ${githubApiErrorMessage(pullsResponse, 'pull request')}`;
      }
      if (!issuesResponse.ok) {
        return `Error: ${githubApiErrorMessage(issuesResponse, 'issue')}`;
      }
      if (!releasesResponse.ok) {
        return `Error: ${githubApiErrorMessage(releasesResponse, 'release')}`;
      }

      const pullRequests: any[] = await pullsResponse.json();
      const issues: any[] = await issuesResponse.json();
      const releases: any[] = await releasesResponse.json();

      const fetchedAt = new Date().toISOString();

      await cacheGitHubActivity(params.owner, params.repo, {
        repository: `${params.owner}/${params.repo}`,
        fetched_at: fetchedAt,
        pull_requests: pullRequests,
        issues,
        releases
      });

      const pullSummary = pullRequests.map(pr => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        author: pr.user?.login,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        closed_at: pr.closed_at,
        merged_at: pr.merged_at,
        draft: pr.draft,
        url: pr.html_url
      }));

      const issueSummary = issues
        .filter(issue => !issue.pull_request)
        .map(issue => ({
          number: issue.number,
          title: issue.title,
          state: issue.state,
          author: issue.user?.login,
          created_at: issue.created_at,
          updated_at: issue.updated_at,
          closed_at: issue.closed_at,
          comments: issue.comments,
          labels: (issue.labels || []).map((label: any) => typeof label === 'string' ? label : label.name),
          url: issue.html_url
        }));

      const releaseSummary = releases.map(release => ({
        id: release.id,
        name: release.name || release.tag_name,
        tag_name: release.tag_name,
        author: release.author?.login,
        created_at: release.created_at,
        published_at: release.published_at,
        draft: release.draft,
        prerelease: release.prerelease,
        body: release.body,
        url: release.html_url
      }));

      return JSON.stringify({
        repository: `${params.owner}/${params.repo}`,
        fetched_at: fetchedAt,
        pull_requests: pullSummary,
        issues: issueSummary.slice(0, 100),
        releases: releaseSummary
      }, null, 2);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
};

export const tools: Tool[] = [
  getRepoInfo,
  listRepoCommits,
  checkRepoMaintenance,
  getRepoActivity
];
