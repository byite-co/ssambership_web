import json, hashlib, re, sys
INV = '/workspace/baseline-work/inventory'
L = lambda n: json.load(open(f'{INV}/{n}.json'))
md5 = lambda s: hashlib.md5(s.encode()).hexdigest()
ws = lambda s: re.sub(r'\s+', ' ', s).strip() if s else ''

def agg(rows):
    rows = sorted(rows)
    return {'n': len(rows), 'md5': md5('\n'.join(rows)) if rows else None}

out = {}
out['tables'] = agg(['%s|%s|%s|%s' % (r['schema'], r['table'], str(r['rls_enabled']).lower(), str(r['rls_forced']).lower())
                     for r in L('tables')])
bt = {(r['schema'], r['table']) for r in L('tables')}
out['columns'] = agg(['%s|%s|%s|%s|%s|%s' % (r['schema'], r['table'], r['column'], r['udt_name'], r['is_nullable'], r.get('column_default') or '')
                      for r in L('columns') if (r['schema'], r['table']) in bt])
out['constraints'] = agg(['%s|%s|%s|%s' % (r['schema'], r['table'], r['conname'], r['definition']) for r in L('constraints')])
out['indexes'] = agg(['%s|%s|%s|%s' % (r['schemaname'], r['tablename'], r['indexname'], r['indexdef']) for r in L('indexes')])
v = L('views'); v = v['views'] if isinstance(v, dict) else v
out['views'] = agg(['%s|%s|%s' % (r['schema'], r['name'], md5(ws(r['definition']))) for r in v])

nocr = {}
for line in open(f'{INV}/functions_md5_nocr.tsv'):
    p = line.rstrip('\n').split('\t')
    if len(p) == 4:
        nocr[(p[0], p[1], p[2])] = p[3]
fr = []
for r in L('functions'):
    key = (r['schema'], r['name'], r.get('identity_args') or '')
    cfg = ','.join(r.get('config') or []) if isinstance(r.get('config'), list) else (r.get('config') or '')
    fr.append('%s|%s|%s|%s|%s|%s' % (r['schema'], r['name'], r.get('identity_args') or '',
                                     nocr.get(key, 'MISSING'), str(bool(r.get('security_definer'))).lower(), cfg))
out['functions'] = agg(fr)
out['triggers'] = agg(['%s|%s|%s|%s' % (r['schema'], r['table'], r['tgname'], md5(r['definition'])) for r in L('triggers')])
p = L('policies'); p = p['policies'] if isinstance(p, dict) else p
out['policies'] = agg(['%s|%s|%s|%s|%s|%s|%s' % (r['schemaname'], r['tablename'], r['policyname'], r['cmd'],
                                                 ','.join(r.get('roles') or []), md5(ws(r.get('qual'))), md5(ws(r.get('with_check'))))
                       for p_ in [0] for r in p])
g = L('grants_tables')['grants']
out['table_grants'] = agg(['%s|%s|%s|%s' % (r['table_schema'], r['table_name'], r['grantee'], pr) for r in g for pr in r['privileges']])
out['buckets'] = agg(['%s|%s|%s|%s' % (r['id'], str(r['public']).lower(),
                                       r['file_size_limit'] if r['file_size_limit'] is not None else '',
                                       ','.join(r['allowed_mime_types'] or [])) for r in L('buckets')])
out['types'] = agg(['%s|%s|%s' % (r['schema'], r['name'], r['definition']) for r in L('enums')])
json.dump(out, open('/tmp/branch-apply/parent_axes.json', 'w'), indent=1)
for k, val in out.items():
    print('%-14s n=%5d md5=%s' % (k, val['n'], val['md5']))
