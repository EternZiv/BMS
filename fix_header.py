#!/usr/bin/env python3
import sys
sys.path.insert(0, '/')
with open('src/components/common/Header.tsx', 'r') as f:
    content = f.read()
# Replace the problematic lines
old = ')) \n                })'
new = '))'
if old in content:
    content = content.replace(old, new)
    with open('src/components/common/Header.tsx', 'w') as f:
        f.write(content)
    print('Fixed')
else:
    print('Pattern not found')
    # Show surrounding content
    idx = content.find(')')
    if idx >= 0:
        print(content[idx-20:idx+20])