-- Tins are their own product family (4-5 standard packs + promos in a metal
-- box); labeling them "case" would render them as UPCs in the UI.
ALTER TYPE "sealed_product_type" ADD VALUE IF NOT EXISTS 'tin';
