-- Issues

CREATE TABLE IF NOT EXISTS issues (
    repo_full_name      VARCHAR(255)    NOT NULL,
    issue_number        INTEGER         NOT NULL,
    author_github_id    VARCHAR(255),
    author_login        VARCHAR(255),
    author_association  VARCHAR(20),
    state               VARCHAR(10)     NOT NULL,
    created_at          TIMESTAMP       NOT NULL,
    closed_at           TIMESTAMP,
    updated_at          TIMESTAMP,
    is_transferred      BOOLEAN         NOT NULL DEFAULT FALSE,

    PRIMARY KEY (repo_full_name, issue_number)
);

CREATE INDEX IF NOT EXISTS idx_issues_author             ON issues(author_github_id);
CREATE INDEX IF NOT EXISTS idx_issues_state              ON issues(state);
CREATE INDEX IF NOT EXISTS idx_issues_closed_at          ON issues(closed_at);
