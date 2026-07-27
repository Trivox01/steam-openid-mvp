export const databaseCommands = {
  games: { all: "get_all_games", byId: "get_game_by_id", save: "upsert_games", update: "update_game", clear: "clear_games" },
  achievements: { all: "get_achievements", byGame: "get_achievements_by_game", byId: "get_achievement_by_id", save: "upsert_achievements", clear: "clear_achievements" },
  activities: { all: "get_activities", save: "save_activities", clear: "clear_activities" },
  preferences: { get: "get_preferences", save: "save_preferences", reset: "reset_preferences" },
  profile: { get: "get_profile", save: "save_profile" },
  sync: { get: "get_sync_metadata", save: "save_sync_metadata" }
} as const;
