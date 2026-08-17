select json_agg(json_build_object('kit_sku', sku, 'nome', nome, 'comp', payload->'kit')) as kits
  from olist_products where tipo='K' and payload ? 'kit' and jsonb_array_length(payload->'kit') > 0;
