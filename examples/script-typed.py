"""型付き整数に1を足す。入出力の行形式は同じlist/dictを指定する。"""
import json
import sys

header = json.loads(sys.stdin.readline())
if header.get("format") != "sagyodai-table" or header.get("version") not in (1, 2):
    raise ValueError("unsupported table format")
print(json.dumps(header, ensure_ascii=False))
for line in sys.stdin:
    row = json.loads(line)
    if header["version"] == 2:
        for value in (row.values() if isinstance(row, dict) else row):
            if value["type"] == "integer":
                number = int(value["value"]) + 1
                if not -(2**63) <= number < 2**63:
                    raise ValueError("64-bit integer overflow")
                value["value"] = str(number)
    print(json.dumps(row, ensure_ascii=False))
