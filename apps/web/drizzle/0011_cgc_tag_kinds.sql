-- CGC 10 and TAG 10 graded prices join PSA in the grading guide (display
-- only — graded EV stays PSA-based, where population odds exist).
ALTER TYPE "price_kind" ADD VALUE IF NOT EXISTS 'cgc10';
ALTER TYPE "price_kind" ADD VALUE IF NOT EXISTS 'tag10';
