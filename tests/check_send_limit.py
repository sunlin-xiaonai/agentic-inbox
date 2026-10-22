"""Run with python3 tests/check_send_limit.py; uses the production SQL."""
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

source = (Path(__file__).resolve().parents[1] / "workers/durableObject/index.ts").read_text()
method = source.split("async checkSendRateLimit()", 1)[1].split("// ── Email creation", 1)[0]
queries = re.findall(r"`(SELECT COUNT\(\*\).*?)`", method, re.S)
assert len(queries) == 1, "Only the 24-hour limit should remain"
limit = int(re.search(r">= (\d+)\)", method)[1])
assert limit == 1000
db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE emails(folder_id TEXT, date TEXT)")
now = datetime.now(timezone.utc)
def add(count, age, folder="sent", offset=False):
    stamp = (now - age).astimezone(timezone(timedelta(hours=8))) if offset else now - age
    db.executemany("INSERT INTO emails VALUES (?, ?)", [(folder, stamp.isoformat())] * count)
def count():
    return db.execute(queries[0], ("sent",)).fetchone()[0]

add(1000, timedelta(hours=25))
add(1000, timedelta(minutes=5), "inbox")
assert count() == 0, "Exclude old sent messages and other folders"
add(21, timedelta(minutes=5))
assert count() == 21 and count() < limit, "No hourly limit"
add(978, timedelta(hours=23), offset=True)
assert count() == 999 and count() < limit, "Allow at 999, including offset timestamps"
add(1, timedelta(minutes=5))
assert count() == 1000 and count() >= limit, "Block at 1000"
print("PASS: 24-hour timestamps, folders, no hourly cap, 999/1000 boundary")
