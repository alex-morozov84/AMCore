# GeoIP reader fixture

`GeoIP2-City-Test.mmdb` is MaxMind's small, synthetic City test database.
Never use it as production location data.
Source: [MaxMind-DB test-data](https://github.com/maxmind/MaxMind-DB/blob/main/test-data/GeoIP2-City-Test.mmdb).
The MIT license notice is preserved in [LICENSE-MIT](LICENSE-MIT).

Offline reader tests use this fixture to check MMDB decoding, locale lookup and
file-generation recovery. The fixture alone does not establish that those tests passed.
