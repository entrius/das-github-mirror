/**
 * Integration test for entrius/das-github-mirror#139.
 *
 * Requires Postgres with schema from packages/db (docker compose up db).
 *
 *   DB_HOST=127.0.0.1 DB_PORT=5434 DB_NAME=github_mirror \
 *   DB_USERNAME=postgres DB_PASSWORD=postgres \
 *   node scripts/integration/test-closed-pr-filter-139.mjs
 */
import pg from "pg";

const { Client } = pg;

const cfg = {
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? "5434"),
  database: process.env.DB_NAME ?? "github_mirror",
  user: process.env.DB_USERNAME ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
};

const AUTHOR = "test-author-139";
const REPO = "testowner/testrepo-139";
const SINCE = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

const FILTER_SQL = `
  SELECT p.pr_number
  FROM pull_requests p
  WHERE p.author_github_id = $1
    AND (
      (p.state = 'OPEN'   AND p.created_at >= $2::timestamptz)
      OR (p.state = 'MERGED' AND p.merged_at >= $2::timestamptz)
      OR (p.state = 'CLOSED' AND p.closed_at >= $2::timestamptz)
    )
  ORDER BY p.pr_number
`;

const OLD_FILTER_SQL = FILTER_SQL.replace(
  "p.closed_at >= $2",
  "p.created_at >= $2",
);

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

async function main() {
  const client = new Client(cfg);
  await client.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO repos (repo_full_name, registered) VALUES ($1, true)
       ON CONFLICT (repo_full_name) DO NOTHING`,
      [REPO],
    );
    await client.query(
      `DELETE FROM pull_requests WHERE repo_full_name = $1 AND author_github_id = $2`,
      [REPO, AUTHOR],
    );

    // Issue #139 scenario: opened 60d ago, closed 5d ago — inside 30d window when filtered by closed_at
    await client.query(
      `INSERT INTO pull_requests (
         repo_full_name, pr_number, author_github_id, state,
         created_at, closed_at, scoring_data_stored
       ) VALUES ($1, 1, $2, 'CLOSED', $3, $4, false)`,
      [REPO, AUTHOR, daysAgo(60), daysAgo(5)],
    );

    // Closed outside window — should not appear
    await client.query(
      `INSERT INTO pull_requests (
         repo_full_name, pr_number, author_github_id, state,
         created_at, closed_at, scoring_data_stored
       ) VALUES ($1, 2, $2, 'CLOSED', $3, $4, false)`,
      [REPO, AUTHOR, daysAgo(60), daysAgo(40)],
    );

    const { rows: fixed } = await client.query(FILTER_SQL, [AUTHOR, SINCE]);
    const fixedNums = fixed.map((r) => r.pr_number).sort();

    const { rows: buggy } = await client.query(OLD_FILTER_SQL, [AUTHOR, SINCE]);
    const buggyNums = buggy.map((r) => r.pr_number).sort();

    if (JSON.stringify(buggyNums) !== "[]") {
      throw new Error(
        `OLD filter should return no rows, got PRs: ${buggyNums.join(", ")}`,
      );
    }
    if (JSON.stringify(fixedNums) !== "[1]") {
      throw new Error(
        `NEW filter should return only PR #1, got: ${JSON.stringify(fixedNums)}`,
      );
    }

    await client.query("ROLLBACK");
    console.log("PASS: integration #139 — CLOSED PR included when closed_at in window");
    console.log("      (old created_at filter correctly excluded all rows)");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
