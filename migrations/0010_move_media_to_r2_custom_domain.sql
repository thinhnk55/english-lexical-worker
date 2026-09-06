-- R2 custom domain is the public delivery origin. Rewrite both authoring rows
-- and already-published runtime snapshots in one idempotent migration.
UPDATE passages
SET image = REPLACE(image, 'https://english-lexical-api.hocnhe.com/assets/', 'https://english-lexical-assets.hocnhe.com/')
WHERE image LIKE 'https://english-lexical-api.hocnhe.com/assets/%';

UPDATE paragraphs
SET image = REPLACE(image, 'https://english-lexical-api.hocnhe.com/assets/', 'https://english-lexical-assets.hocnhe.com/')
WHERE image LIKE 'https://english-lexical-api.hocnhe.com/assets/%';

UPDATE sentences
SET audio = REPLACE(audio, 'https://english-lexical-api.hocnhe.com/assets/', 'https://english-lexical-assets.hocnhe.com/'),
    image = REPLACE(image, 'https://english-lexical-api.hocnhe.com/assets/', 'https://english-lexical-assets.hocnhe.com/')
WHERE audio LIKE 'https://english-lexical-api.hocnhe.com/assets/%'
   OR image LIKE 'https://english-lexical-api.hocnhe.com/assets/%';

UPDATE lexicals
SET audio = REPLACE(audio, 'https://english-lexical-api.hocnhe.com/assets/', 'https://english-lexical-assets.hocnhe.com/'),
    image = REPLACE(image, 'https://english-lexical-api.hocnhe.com/assets/', 'https://english-lexical-assets.hocnhe.com/')
WHERE audio LIKE 'https://english-lexical-api.hocnhe.com/assets/%'
   OR image LIKE 'https://english-lexical-api.hocnhe.com/assets/%';

UPDATE passages_runtime
SET payload = REPLACE(payload, 'https://english-lexical-api.hocnhe.com/assets/', 'https://english-lexical-assets.hocnhe.com/')
WHERE payload LIKE '%https://english-lexical-api.hocnhe.com/assets/%';
