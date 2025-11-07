// src/index.ts
var getRepoInfo = {
  name: "github_repo_info",
  description: "Get information about a GitHub repository",
  inputSchema: {
    type: "object",
    properties: {
      owner: {
        type: "string",
        description: "Repository owner (username or organization)"
      },
      repo: {
        type: "string",
        description: "Repository name"
      }
    },
    required: ["owner", "repo"]
  },
  execute: async (params) => {
    try {
      const url = `https://api.github.com/repos/${params.owner}/${params.repo}`;
      const response = await fetch(url, {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Kitty-AI-Agent"
        }
      });
      if (!response.ok) {
        if (response.status === 404) {
          return `Repository ${params.owner}/${params.repo} not found`;
        }
        return `Error: ${response.status} ${response.statusText}`;
      }
      const data = await response.json();
      return JSON.stringify({
        name: data.name,
        full_name: data.full_name,
        description: data.description,
        stars: data.stargazers_count,
        forks: data.forks_count,
        open_issues: data.open_issues_count,
        language: data.language,
        license: data.license?.spdx_id || "None",
        created_at: data.created_at,
        updated_at: data.updated_at,
        homepage: data.homepage,
        archived: data.archived,
        disabled: data.disabled
      }, null, 2);
    } catch (error) {
      return `Error: ${error.message}`;
    }
  }
};
var listRepoCommits = {
  name: "github_list_commits",
  description: "List recent commits from a GitHub repository",
  inputSchema: {
    type: "object",
    properties: {
      owner: {
        type: "string",
        description: "Repository owner"
      },
      repo: {
        type: "string",
        description: "Repository name"
      },
      limit: {
        type: "number",
        description: "Number of commits to fetch (default: 10, max: 100)"
      }
    },
    required: ["owner", "repo"]
  },
  execute: async (params) => {
    try {
      const limit = Math.min(params.limit || 10, 100);
      const url = `https://api.github.com/repos/${params.owner}/${params.repo}/commits?per_page=${limit}`;
      const response = await fetch(url, {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Kitty-AI-Agent"
        }
      });
      if (!response.ok) {
        return `Error: ${response.status} ${response.statusText}`;
      }
      const commits = await response.json();
      const commitList = commits.map((commit) => ({
        sha: commit.sha.substring(0, 7),
        message: commit.commit.message.split(`
`)[0],
        author: commit.commit.author.name,
        date: commit.commit.author.date
      }));
      return JSON.stringify(commitList, null, 2);
    } catch (error) {
      return `Error: ${error.message}`;
    }
  }
};
var checkRepoMaintenance = {
  name: "github_check_maintenance",
  description: "Check if a GitHub repository appears to be actively maintained",
  inputSchema: {
    type: "object",
    properties: {
      owner: {
        type: "string",
        description: "Repository owner"
      },
      repo: {
        type: "string",
        description: "Repository name"
      }
    },
    required: ["owner", "repo"]
  },
  execute: async (params) => {
    try {
      const [repoResponse, commitsResponse] = await Promise.all([
        fetch(`https://api.github.com/repos/${params.owner}/${params.repo}`, {
          headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "Kitty-AI-Agent" }
        }),
        fetch(`https://api.github.com/repos/${params.owner}/${params.repo}/commits?per_page=1`, {
          headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "Kitty-AI-Agent" }
        })
      ]);
      if (!repoResponse.ok || !commitsResponse.ok) {
        return "Error: Unable to fetch repository information";
      }
      const repo = await repoResponse.json();
      const commits = await commitsResponse.json();
      const lastCommit = commits[0];
      const lastCommitDate = lastCommit?.commit?.author?.date;
      const lastCommitSha = lastCommit?.sha;
      const lastCommitMessage = lastCommit?.commit?.message?.split(`
`)[0];
      const monthsSinceLastCommit = lastCommitDate ? (Date.now() - new Date(lastCommitDate).getTime()) / (1000 * 60 * 60 * 24 * 30) : Infinity;
      const isArchived = repo.archived;
      const isDisabled = repo.disabled;
      const hasRecentActivity = monthsSinceLastCommit < 6;
      let status = "maintained";
      if (isArchived || isDisabled) {
        status = "archived";
      } else if (monthsSinceLastCommit > 12) {
        status = "unmaintained";
      } else if (monthsSinceLastCommit > 6) {
        status = "stale";
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
        recommendation: status === "maintained" ? "Repository appears actively maintained" : status === "archived" ? "Repository is archived and no longer maintained" : "Repository may not be actively maintained - use with caution"
      }, null, 2);
    } catch (error) {
      return `Error: ${error.message}`;
    }
  }
};
var tools = [
  getRepoInfo,
  listRepoCommits,
  checkRepoMaintenance
];
export {
  tools
};
