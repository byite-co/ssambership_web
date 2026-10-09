#!/usr/bin/env python3
"""Download/check the exact approved Linux CLI; no database access."""
import hashlib, pathlib, sys, tarfile, urllib.request
directory=pathlib.Path(sys.argv[1]);directory.mkdir(parents=True,exist_ok=True)
archive=directory/'cli.tar.gz'
url='https://github.com/supabase/cli/releases/download/v2.111.0/supabase_2.111.0_linux_amd64.tar.gz'
with urllib.request.urlopen(url,timeout=60) as response,archive.open('wb') as out:
    total=0
    while block:=response.read(1024*1024):
        total+=len(block)
        if total>100*1024*1024:raise SystemExit('CLI_ARCHIVE_TOO_LARGE')
        out.write(block)
assert hashlib.sha256(archive.read_bytes()).hexdigest()=='31ee8a152e9c8c8eddae072c6bc7c9119748a96c8cdaf21a6d31c9ce7e62cc18'
with tarfile.open(archive,'r:gz') as tar:
    for name in ['supabase','supabase-go']:
        entries=[x for x in tar.getmembers() if pathlib.PurePosixPath(x.name).name==name and x.isfile()]
        assert len(entries)==1
        source=tar.extractfile(entries[0]);assert source
        destination=directory/name;destination.write_bytes(source.read());destination.chmod(0o755)
assert hashlib.sha256((directory/'supabase').read_bytes()).hexdigest()=='f038518c4a116c343249f29669df5a13adc27626c89b14f4187779b5bbd1629c'
print('APPROVED_CLI_BYTES_VERIFIED')
