#!/usr/bin/env python3
with open('supabase/js/supabaseClient.ts', 'r') as f:
    content = f.read()
new_content = content.replace('} > {', '} => {')
with open('supabase/js/supabaseClient.ts', 'w') as f:
    f.write(new_content)
print('Done')