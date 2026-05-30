-- Widen filename columns from VARCHAR(500) to TEXT so that valid Git file
-- paths longer than 500 characters do not cause PR file ingestion to fail.

ALTER TABLE pr_files
  ALTER COLUMN filename          TYPE TEXT,
  ALTER COLUMN previous_filename TYPE TEXT;

ALTER TABLE pr_file_contents
  ALTER COLUMN filename TYPE TEXT;
