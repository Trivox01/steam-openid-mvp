import sqlite3, sys, time

connection = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True)
started = time.perf_counter()
rows = connection.execute("select id,name,tracked,last_opened_at from games where hidden=0 order by tracked desc,last_played_at desc,name collate nocase limit 30 offset 0").fetchall()
elapsed_ms = (time.perf_counter() - started) * 1000
print({
    "games": connection.execute("select count(*) from games").fetchone()[0],
    "migration": connection.execute("select max(version) from _achievement_nexus_migrations").fetchone()[0],
    "page_rows": len(rows), "query_ms": round(elapsed_ms, 3),
    "tracked": connection.execute("select count(*) from games where tracked=1").fetchone()[0],
})
print(connection.execute("select platform_game_id,name,cover_url,achievements_total from games where platform_game_id='2807960' or lower(name) like '%super sus%' order by platform_game_id").fetchall())
