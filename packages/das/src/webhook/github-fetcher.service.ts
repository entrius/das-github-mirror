/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { readFileSync } from "fs";
import { sign } from "jsonwebtoken";
import { Issue, PrFile, PrFileContent, PullRequest, Repo } from "../entities";

interface InstallationToken {
  token: string;
  expiresAt: number;
}

@Injectable()
export class GitHubFetcherService implements OnModuleInit {
  private readonly logger = new Logger(GitHubFetcherService.name);
  private readonly appId: string;
  private privateKey: string;
  private readonly tokenCache = new Map<string, InstallationToken>();

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(PrFile)
    private readonly prFileRepo: Repository<PrFile>,
    @InjectRepository(PrFileContent)
    private readonly prFileContentRepo: Repository<PrFileContent>,
    @InjectRepository(PullRequest)
    private readonly prRepo: Repository<PullRequest>,
    @InjectRepository(Issue)
    private readonly issueRepo: Repository<Issue>,
    @InjectRepository(Repo)
    private readonly repoRepo: Repository<Repo>,
  ) {
    this.appId = this.config.getOrThrow("GITHUB_APP_ID");
  }

  onModuleInit(): void {
    const keyPath = this.config.getOrThrow("GITHUB_PRIVATE_KEY_PATH");
    this.privateKey = readFileSync(keyPath, "utf8");
  }

  // --- Authentication ---

  private createAppJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    return sign(
      { iss: this.appId, iat: now - 60, exp: now + 600 },
      this.privateKey,
      { algorithm: "RS256" },
    );
  }

  private async getInstallationToken(installationId: string): Promise<string> {
    const cached = this.tokenCache.get(installationId);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.token;
    }

    const jwt = this.createAppJwt();
    const res = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
        },
      },
    );

    if (!res.ok) {
      throw new Error(
        `Failed to get installation token: ${res.status} ${await res.text()}`,
      );
    }

    const body = await res.json();
    this.tokenCache.set(installationId, {
      token: body.token,
      expiresAt: new Date(body.expires_at).getTime(),
    });

    return body.token;
  }

  private async getTokenForRepo(repoFullName: string): Promise<string> {
    const repo = await this.repoRepo.findOneBy({ repoFullName });
    if (!repo?.installationId) {
      throw new Error(`No installation for repo ${repoFullName}`);
    }
    return this.getInstallationToken(repo.installationId);
  }

  // --- GraphQL: closingIssuesReferences ---

  async fetchClosingIssueNumbers(
    repoFullName: string,
    prNumber: number,
  ): Promise<number[]> {
    const [owner, repo] = repoFullName.split("/");
    const token = await this.getTokenForRepo(repoFullName);

    const query = `
      query($owner: String!, $repo: String!, $pr: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $pr) {
            closingIssuesReferences(first: 10) {
              nodes { number }
            }
          }
        }
      }
    `;

    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: { owner, repo, pr: prNumber },
      }),
    });

    if (!res.ok) {
      throw new Error(
        `GraphQL request failed: ${res.status} ${await res.text()}`,
      );
    }

    const body = await res.json();
    const nodes =
      body.data?.repository?.pullRequest?.closingIssuesReferences?.nodes ?? [];

    return nodes.map((n: { number: number }) => n.number);
  }

  // --- REST: PR files + contents ---

  async fetchAndStorePrFiles(
    repoFullName: string,
    prNumber: number,
  ): Promise<void> {
    const [owner, repo] = repoFullName.split("/");
    const token = await this.getTokenForRepo(repoFullName);

    // Grab PR metadata for base/head SHAs
    const pr = await this.prRepo.findOneBy({ repoFullName, prNumber });
    if (!pr) {
      throw new Error(`PR ${repoFullName}#${prNumber} not found in DB`);
    }

    // Fetch file list (paginated)
    const files = await this.fetchAllPrFiles(owner, repo, prNumber, token);

    // Delete existing file data for this PR (in case of synchronize)
    await this.prFileRepo.delete({ repoFullName, prNumber });
    await this.prFileContentRepo.delete({ repoFullName, prNumber });

    for (const file of files) {
      await this.prFileRepo.upsert(
        {
          repoFullName,
          prNumber,
          filename: file.filename,
          previousFilename: file.previous_filename ?? null,
          status: file.status,
          additions: file.additions ?? 0,
          deletions: file.deletions ?? 0,
          changes: file.changes ?? 0,
        },
        ["repoFullName", "prNumber", "filename"],
      );

      // Fetch file contents for non-binary, non-removed files
      if (file.status !== "removed" && !this.isBinary(file.filename)) {
        await this.fetchAndStoreFileContent(
          repoFullName,
          prNumber,
          file,
          owner,
          repo,
          token,
          pr.headSha,
          pr.baseSha,
        );
      }
    }
  }

  private async fetchAllPrFiles(
    owner: string,
    repo: string,
    prNumber: number,
    token: string,
  ): Promise<any[]> {
    const files: any[] = [];
    let page = 1;

    while (true) {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
          },
        },
      );

      if (!res.ok) {
        throw new Error(
          `Failed to fetch PR files: ${res.status} ${await res.text()}`,
        );
      }

      const batch = await res.json();
      files.push(...batch);

      if (batch.length < 100) break;
      page++;
    }

    return files;
  }

  private async fetchAndStoreFileContent(
    repoFullName: string,
    prNumber: number,
    file: any,
    owner: string,
    repo: string,
    token: string,
    headSha: string | null,
    baseSha: string | null,
  ): Promise<void> {
    try {
      // Head version — fetch at the PR's head commit SHA (not file.sha which is a blob SHA).
      // The contents API needs a commit/branch/tag ref, not a blob SHA.
      let headContent: string | null = null;
      if (headSha) {
        headContent = await this.fetchFileAtRef(
          owner,
          repo,
          file.filename,
          headSha,
          token,
        );
      }

      // Base version — the file contents as of the PR's base commit.
      // For renames, use the previous filename. For "added" files, no base version exists.
      let baseContent: string | null = null;
      if (file.status !== "added" && baseSha) {
        const basePath = file.previous_filename ?? file.filename;
        baseContent = await this.fetchFileAtRef(
          owner,
          repo,
          basePath,
          baseSha,
          token,
        );
      }

      await this.prFileContentRepo.upsert(
        {
          repoFullName,
          prNumber,
          filename: file.filename,
          baseContent,
          headContent,
          isBinary: false,
          byteSize: headContent ? Buffer.byteLength(headContent) : null,
        },
        ["repoFullName", "prNumber", "filename"],
      );
    } catch (err) {
      this.logger.warn(`Failed to fetch content for ${file.filename}: ${err}`);
    }
  }

  private async fetchFileAtRef(
    owner: string,
    repo: string,
    path: string,
    sha: string | null,
    token: string,
  ): Promise<string | null> {
    const ref = sha ? `?ref=${sha}` : "";
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}${ref}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.raw+json",
        },
      },
    );

    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Failed to fetch file: ${res.status}`);
    }

    return res.text();
  }

  private isBinary(filename: string): boolean {
    const binaryExts = [
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".ico",
      ".svg",
      ".woff",
      ".woff2",
      ".ttf",
      ".eot",
      ".zip",
      ".tar",
      ".gz",
      ".bz2",
      ".pdf",
      ".exe",
      ".dll",
      ".so",
      ".dylib",
      ".bin",
      ".dat",
      ".db",
      ".sqlite",
    ];
    const lower = filename.toLowerCase();
    return binaryExts.some((ext) => lower.endsWith(ext));
  }

  // --- Backfill ---

  /**
   * Page through GraphQL for PRs in a repo created within the last N days.
   * Upserts each PR. Returns the list of merged PR numbers so the caller can
   * enqueue follow-up fetch jobs for diffs + closing issues.
   */
  async backfillPullRequests(
    repoFullName: string,
    sinceDate: Date,
  ): Promise<{ prNumber: number; isMerged: boolean }[]> {
    const [owner, repo] = repoFullName.split("/");
    const token = await this.getTokenForRepo(repoFullName);

    const query = `
      query($owner: String!, $repo: String!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          pullRequests(
            first: 50,
            after: $cursor,
            orderBy: {field: CREATED_AT, direction: DESC}
          ) {
            pageInfo { hasNextPage endCursor }
            nodes {
              number
              title
              state
              createdAt
              closedAt
              mergedAt
              updatedAt
              merged
              author {
                login
                ... on User { databaseId }
                ... on Bot { databaseId }
              }
              authorAssociation
              mergedBy { login }
              baseRef { name }
              baseRefOid
              headRefOid
              additions
              deletions
              commits { totalCount }
              labels(first: 20) { nodes { name } }
            }
          }
        }
      }
    `;

    const prs: { prNumber: number; isMerged: boolean }[] = [];
    let cursor: string | null = null;

    while (true) {
      const res: Response = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          variables: { owner, repo, cursor },
        }),
      });

      if (!res.ok) {
        throw new Error(
          `Backfill PR GraphQL failed: ${res.status} ${await res.text()}`,
        );
      }

      const body: any = await res.json();
      const page: any = body.data?.repository?.pullRequests;
      if (!page) break;

      let shouldStop = false;
      for (const pr of page.nodes) {
        // Ordered DESC by created_at — stop once we cross the cutoff
        if (new Date(pr.createdAt) < sinceDate) {
          shouldStop = true;
          break;
        }

        await this.prRepo.upsert(
          {
            repoFullName,
            prNumber: pr.number,
            authorGithubId: String(pr.author?.databaseId ?? ""),
            authorLogin: pr.author?.login ?? null,
            authorAssociation: pr.authorAssociation ?? null,
            title: pr.title,
            state: pr.state, // OPEN / CLOSED / MERGED
            createdAt: pr.createdAt,
            closedAt: pr.closedAt ?? null,
            mergedAt: pr.mergedAt ?? null,
            lastEditedAt: pr.updatedAt ?? null,
            mergedByLogin: pr.mergedBy?.login ?? null,
            baseRef: pr.baseRef?.name ?? null,
            headSha: pr.headRefOid ?? null,
            baseSha: pr.baseRefOid ?? null,
            additions: pr.additions ?? null,
            deletions: pr.deletions ?? null,
            commitsCount: pr.commits?.totalCount ?? null,
            labels: (pr.labels?.nodes ?? []).map(
              (l: { name: string }) => l.name,
            ),
          },
          ["repoFullName", "prNumber"],
        );

        prs.push({ prNumber: pr.number, isMerged: !!pr.merged });
      }

      if (shouldStop || !page.pageInfo.hasNextPage) break;
      cursor = page.pageInfo.endCursor;
    }

    return prs;
  }

  /**
   * Page through GraphQL for issues in a repo created within the last N days.
   * Upserts each issue.
   */
  async backfillIssues(repoFullName: string, sinceDate: Date): Promise<void> {
    const [owner, repo] = repoFullName.split("/");
    const token = await this.getTokenForRepo(repoFullName);

    const query = `
      query($owner: String!, $repo: String!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          issues(
            first: 50,
            after: $cursor,
            orderBy: {field: CREATED_AT, direction: DESC}
          ) {
            pageInfo { hasNextPage endCursor }
            nodes {
              number
              title
              state
              stateReason
              createdAt
              closedAt
              updatedAt
              author {
                login
                ... on User { databaseId }
                ... on Bot { databaseId }
              }
              authorAssociation
              labels(first: 20) { nodes { name } }
            }
          }
        }
      }
    `;

    let cursor: string | null = null;

    while (true) {
      const res: Response = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          variables: { owner, repo, cursor },
        }),
      });

      if (!res.ok) {
        throw new Error(
          `Backfill issue GraphQL failed: ${res.status} ${await res.text()}`,
        );
      }

      const body: any = await res.json();
      const page: any = body.data?.repository?.issues;
      if (!page) break;

      let shouldStop = false;
      for (const issue of page.nodes) {
        if (new Date(issue.createdAt) < sinceDate) {
          shouldStop = true;
          break;
        }

        await this.issueRepo.upsert(
          {
            repoFullName,
            issueNumber: issue.number,
            authorGithubId: String(issue.author?.databaseId ?? ""),
            authorLogin: issue.author?.login ?? null,
            authorAssociation: issue.authorAssociation ?? null,
            title: issue.title,
            state: issue.state, // OPEN / CLOSED
            stateReason: issue.stateReason ?? null,
            createdAt: issue.createdAt,
            closedAt: issue.closedAt ?? null,
            updatedAt: issue.updatedAt ?? null,
            labels: (issue.labels?.nodes ?? []).map(
              (l: { name: string }) => l.name,
            ),
          },
          ["repoFullName", "issueNumber"],
        );
      }

      if (shouldStop || !page.pageInfo.hasNextPage) break;
      cursor = page.pageInfo.endCursor;
    }
  }
}
