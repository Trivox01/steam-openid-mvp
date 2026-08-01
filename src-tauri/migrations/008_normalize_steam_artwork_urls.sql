UPDATE games
SET cover_url = REPLACE(
  cover_url,
  'https://shared.cloudflare.steamstatic.com/',
  'https://shared.steamstatic.com/'
)
WHERE platform_id = 'steam'
  AND cover_url LIKE 'https://shared.cloudflare.steamstatic.com/%';

UPDATE games
SET background_url = REPLACE(
  background_url,
  'https://shared.cloudflare.steamstatic.com/',
  'https://shared.steamstatic.com/'
)
WHERE platform_id = 'steam'
  AND background_url LIKE 'https://shared.cloudflare.steamstatic.com/%';
