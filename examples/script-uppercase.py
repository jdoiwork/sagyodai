"""作業台のJSON Linesを受け取り、文字列を大文字に変換する例。"""
import json
import sys

header = json.loads(sys.stdin.readline())
if header.get("format") != "sagyodai-table" or header.get("version") != 1:
    raise ValueError("未対応の入力形式です")
print(json.dumps(header, ensure_ascii=False))
count = 0
for line in sys.stdin:
    row = json.loads(line)
    print(json.dumps([value.upper() for value in row], ensure_ascii=False))
    count += 1
print(f"{count}行を加工しました", file=sys.stderr)
