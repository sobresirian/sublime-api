-- Descuento en guaranies por producto: 1 = el producto NO lleva el descuento de 2 US$ en Gs.
ALTER TABLE productos ADD COLUMN gs_sin_desc INTEGER DEFAULT 0;
