-- The desktop no longer accepts a Steam Web API key. Remove the profile row that
-- identified the retired manual-credential flow, then remove its dedicated table.
DELETE FROM steam_profile;
DROP TABLE IF EXISTS steam_profile;
