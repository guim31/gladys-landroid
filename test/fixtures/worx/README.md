# Worx cloud fixtures

Answers of `GET /api/v2/product-items?status=1` and `GET /api/v2/products`,
written for these tests. The field names, the payload layout and the status and
error codes follow the protocol as the community documents it (ioBroker.worx,
MIT; the payload descriptions of the HACS landroid_cloud project, read but not
copied: GPL-3.0). Every value is invented: serial numbers, MAC addresses,
uuids, coordinates and names belong to no real mower or account.

- `product-items.json`: a wire mower (protocol 0, Landroid M500) at its base,
  charging, with zones and a rain sensor; a Vision mower (protocol 1) mowing;
  an older wire mower, offline, without rain sensor, lock or zones.
- `product-items-kress.json`: a Kress RTK mower (protocol 1) waiting after
  rain (error 5, counter in seconds), locked, with an RTK position.
- `products.json`: the model catalog entries of these mowers.
