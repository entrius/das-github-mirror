import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const dbDir = join(__dirname, "../../db");

function readDbSql(fileName: string): string {
  return readFileSync(join(dbDir, fileName), "utf8");
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

void test("contributor_repo_roles includes review and comment association evidence", (): void => {
  const sql = normalizeSql(readDbSql("20_view_contributor_repo_roles.sql"));

  assert.match(sql, /FROM pull_requests\b/);
  assert.match(sql, /FROM issues\b/);
  assert.match(sql, /FROM reviews\b/);
  assert.match(sql, /reviewer_github_id AS author_github_id/);
  assert.match(sql, /reviewer_login AS author_login/);
  assert.match(sql, /reviewer_association AS author_association/);
  assert.match(sql, /submitted_at AS observed_at/);
  assert.match(sql, /FROM comments\b/);
  assert.match(sql, /COALESCE\(updated_at, created_at\) AS observed_at/);
});

void test("contributor_repo_roles keeps latest known non-null roles deterministic", (): void => {
  const sql = normalizeSql(readDbSql("20_view_contributor_repo_roles.sql"));

  assert.match(sql, /author_association IS NOT NULL/);
  assert.match(sql, /reviewer_association IS NOT NULL/);
  assert.match(sql, /'pr:' \|\| pr_number::text AS source_key/);
  assert.match(sql, /'issue:' \|\| issue_number::text AS source_key/);
  assert.match(sql, /'review:' \|\| pr_number::text/);
  assert.match(sql, /'comment:' \|\| comment_id::text AS source_key/);
  assert.match(
    sql,
    /ORDER BY repo_full_name, author_github_id, observed_at DESC, source_rank DESC, source_key DESC/,
  );
});

void test("label actor views resolve roles through contributor_repo_roles", (): void => {
  const prLabelsSql = normalizeSql(readDbSql("24_view_pr_labels_by_actor.sql"));
  const issueLabelsSql = normalizeSql(
    readDbSql("25_view_issue_labels_by_actor.sql"),
  );

  for (const sql of [prLabelsSql, issueLabelsSql]) {
    assert.match(sql, /LEFT JOIN contributor_repo_roles crr/);
    assert.match(sql, /crr.author_github_id = le.actor_github_id/);
    assert.match(sql, /crr.repo_full_name = le.repo_full_name/);
    assert.match(sql, /crr.author_association AS actor_association/);
  }
});
