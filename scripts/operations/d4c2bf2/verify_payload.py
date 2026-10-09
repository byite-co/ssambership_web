#!/usr/bin/env python3
"""Offline manifest and initial-pack gate; no DB credentials or connections."""
import hashlib,json,pathlib
root=pathlib.Path(__file__).resolve().parent
m=json.loads((root/'manifest.json').read_text())
assert m['candidate_commit']=='d4c2bf28755169e79a5fd2891537a8734dbf08f6'
assert m['candidate_tree']=='5b43ef77e4de8b8dfb3f38a405799cebabd338ca'
for name,want in m['files'].items():
    p=root/name
    assert p.resolve().is_relative_to(root.resolve()) and p.is_file()
    assert hashlib.sha256(p.read_bytes()).hexdigest()==want, 'PAYLOAD_HASH_MISMATCH'
files=sorted((root/'payload/first-apply-project/supabase/migrations').glob('*.sql'))
assert len(files)==128
assert files[-1].name=='20261009070000_staging_integration.sql'
assert hashlib.sha256(files[-1].read_bytes()).hexdigest()=='aebdf9702f7750fdbea0cdc72c8bced99ad69917d5b2a4a689a4eaa42a3d6be1'
assert not any(p.name.startswith(('20261009070100','20261009070200','20261009010000')) for p in files)
print('OFFLINE_PAYLOAD_PASS: 127 historical + 070000; no recovery files')
