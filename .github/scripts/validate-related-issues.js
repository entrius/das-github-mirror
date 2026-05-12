#!/usr/bin/env node

const rawBody = process.env.PR_BODY || "";
const body = rawBody.replace(/<!--[\s\S]*?-->/g, "");

const relatedSectionMatch = body.match(
  /##\s*Related Issues\s*([\s\S]*?)(?:\n##\s|\n#\s|$)/i,
);

if (!relatedSectionMatch) {
  console.error("Missing `## Related Issues` section in PR description.");
  process.exit(1);
}

const relatedSection = relatedSectionMatch[1].trim();
if (!relatedSection) {
  console.error("`## Related Issues` section is empty.");
  process.exit(1);
}

const issueRefPattern =
  /(https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/\d+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+|#\d+)/i;
const noIssuePattern = /\b(?:N\/A|NA|NONE|NO ISSUE)\b/i;

if (issueRefPattern.test(relatedSection) || noIssuePattern.test(relatedSection)) {
  console.log("Related issue check passed.");
  process.exit(0);
}

console.error(
  "Add at least one issue reference in `## Related Issues` (for example `Fixes #123`) " +
    "or explicitly write `N/A`.",
);
process.exit(1);
