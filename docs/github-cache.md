# GitHub Cache Format

The GitHub integrations now write two distinct cache trees under `~/.kitty/cache/github`:

| Path | Producer | Contents |
|------|----------|----------|
| `activity/<owner>__<repo>.json` | `github_repo_activity` plugin tool | Raw GitHub responses for PRs, issues, releases |
| `sbom/<YYYY-MM-DD>/<owner>__<repo>.json` | `batch_analyze_github_packages` SBOM tool | Repository summaries that also embed activity snapshots |

## SBOM Cache Schema

Each SBOM cache file contains a compact summary plus the richer GitHub payloads. Example:

```json
{
  "summary": {
    "owner": "42wim",
    "repo": "httpsig",
    "github_url": "https://github.com/42wim/httpsig",
    "stars": 2,
    "forks": 1,
    "open_issues": 0,
    "license": "BSD-3-Clause",
    "archived": false,
    "last_commit_sha": "747b79b",
    "last_commit_date": "2025-05-02T15:45:51Z",
    "months_since_last_commit": 6.4,
    "status": "stale",
    "purl": "pkg:golang/github.com/42wim/httpsig@v1.2.2",
    "version": "v1.2.2"
  },
  "activity_snapshot": {
    "fetched_at": "2025-11-10T10:02:14.123Z",
    "pull_requests": [
      {
        "number": 42,
        "title": "Add universal signature verifier",
        "state": "open",
        "author": "octocat",
        "created_at": "2025-10-31T12:15:00Z",
        "updated_at": "2025-11-05T08:07:00Z",
        "closed_at": null,
        "merged_at": null,
        "draft": false,
        "url": "https://github.com/42wim/httpsig/pull/42"
      }
    ],
    "issues": [
      {
        "number": 101,
        "title": "Document SSH agent usage",
        "state": "closed",
        "author": "alice",
        "created_at": "2025-10-10T09:00:00Z",
        "updated_at": "2025-10-12T18:42:00Z",
        "closed_at": "2025-10-12T18:42:00Z",
        "comments": 2,
        "labels": ["docs"],
        "url": "https://github.com/42wim/httpsig/issues/101"
      }
    ],
    "releases": [
      {
        "id": 123456,
        "name": "v1.2.2",
        "tag_name": "v1.2.2",
        "author": "42wim",
        "created_at": "2025-05-01T07:00:00Z",
        "published_at": "2025-05-02T08:00:00Z",
        "draft": false,
        "prerelease": false,
        "body": "Bug fixes and improved signature handling.",
        "url": "https://github.com/42wim/httpsig/releases/tag/v1.2.2"
      }
    ]
  },
  "activity_raw": {
    "pull_requests": [ /* full GitHub API responses */ ],
    "issues": [ /* full GitHub API responses (non-PR issues only) */ ],
    "releases": [ /* full GitHub API responses */ ]
  }
}
```

### Field Reference

- `summary`: Stable metadata used for quick filtering (`jq '.summary'`). Includes ownership, licensing, maintenance status, and SBOM PURL/version.
- `activity_snapshot`: Normalized view extracted from GitHub. Limited to the last 10 PRs, last 100 issues (excluding PRs), and last 10 releases. The `fetched_at` timestamp shows when the snapshot was taken.
- `activity_raw`: Lossless copy of the GitHub responses so you can reprocess additional fields later without re-hitting the API.

### Query Tips

- Read only the summary: `jq '.summary' gobwas__glob.json`
- Count stale repos in a batch result: `jq '[.packages[] | select(.summary.status=="stale")] | length' batch.json`
- Inspect the most recent release body: `jq '.activity_snapshot.releases[0].body' gobwas__glob.json`

Use the activity files for full API fidelity and the SBOM summaries for lightweight reporting. Both caches can be safely deleted; they will be regenerated on demand. 
