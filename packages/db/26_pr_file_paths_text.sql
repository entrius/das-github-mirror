-- Allow valid Git paths longer than 500 characters.
-- GitHub's PR files API returns full repo-relative paths, which can exceed
-- the previous VARCHAR(500) cap when directories are deeply nested.

ALTER TABLE pr_files
    ALTER COLUMN filename TYPE TEXT,
    ALTER COLUMN previous_filename TYPE TEXT;

ALTER TABLE pr_file_contents
    ALTER COLUMN filename TYPE TEXT;
