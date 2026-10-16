from pathlib import Path

root = Path(__file__).resolve().parent.parent
p = root / '.dev.vars'
lines = p.read_text(encoding='utf-8').splitlines()
header = next(line for line in lines if line.startswith('BUS_ROUTES_CSV='))
kept = [header] + [line for line in lines[1:] if '紅28' in line or 'R28' in line]
p.write_text('\n'.join(kept) + '\n', encoding='utf-8')
print(f'kept {len(kept) - 1} route rows')
for line in kept[-2:]:
    print(line)
