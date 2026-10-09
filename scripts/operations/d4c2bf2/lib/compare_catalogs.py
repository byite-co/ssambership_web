#!/usr/bin/env python3
"""Object-by-object evidence, never a guard normalizer or apply authorization."""
import argparse
from collections import Counter
import hashlib
import json
import re
from pathlib import Path

KEYS={'functions':['schema','identity'],'relations':['schema','name'],
      'columns':['schema','table','name'],'indexes':['schema','name'],
      'constraints':['schema','table','name'],'triggers':['schema','table','name'],
      'policies':['schema','table','name'],'default_acl':['owner','schema','object_type'],'schemas':['schema']}

def classify(section, a, b):
    row=b or a
    if section=='triggers' and re.fullmatch(r'RI_ConstraintTrigger_[ac]_\d+',row['name']):
        return 'EXPECTED_DATABASE_LOCAL_IDENTIFIER_DIFFERENCE','Internal FK trigger names contain instance-local OIDs. Pair trigger definitions and verify associated raw constraints separately; never waive user triggers.'
    if row.get('schema') not in ('public','core_private','api_web_v1','api_app_v1'):
        return 'EXPECTED_MANAGED_PLATFORM_DIFFERENCE', 'Reproduce dependencies/ownership and retain raw guards; this label is not a waiver.'
    if section=='functions' and a and b:
        fields=[k for k in a.keys()|b.keys() if a.get(k)!=b.get(k)]
        if fields==['definition'] and a['definition'].replace('\r\n','\n')==b['definition'].replace('\r\n','\n'):
            return 'CANDIDATE_OR_FIXTURE_CHANGE_REQUIRED','CRLF-only classification; exact original bytes remain in both diff and guard. No normalized comparison authorizes apply.'
        if fields==['comment']:
            return 'CANDIDATE_OR_FIXTURE_CHANGE_REQUIRED','Comment differs; preserve live value and exact compensation. Executable body/security metadata identical.'
    if section=='columns' and a and b and all(a[k]==b[k] for k in a if k!='position'):
        return 'CANDIDATE_OR_FIXTURE_CHANGE_REQUIRED','Physical attribute position differs; recreate empty local fixture, never reorder live columns.'
    if section in ('schemas','default_acl'):
        return 'CANDIDATE_OR_FIXTURE_CHANGE_REQUIRED','Observed grantor/owner/default ACL must be retained and executed under an explicitly verified maintenance role.'
    return 'APPLY_BLOCKED_PENDING_REVIEW','Unclassified raw difference; must not be accepted automatically.'

def diff(a,b):
    result={};summary={}
    for section,keys in KEYS.items():
        index=lambda c:{tuple(o[k] for k in keys):o for o in c[section]}
        x=index(a);y=index(b);changes=[]
        assert len(x)==len(a[section]) and len(y)==len(b[section])
        for key in sorted(x.keys()|y.keys(),key=str):
            left=x.get(key);right=y.get(key)
            if left==right:continue
            category,reason=classify(section,left,right)
            changes.append({'key':key,'kind':'added' if left is None else 'removed' if right is None else 'changed',
                'changed_fields':sorted(k for k in (left or {}).keys()|(right or {}).keys() if (left or {}).get(k)!=(right or {}).get(k)),
                'classification':category,'reason':reason,'local':left,'staging':right})
        result[section]=changes
        summary[section]={'local_count':len(x),'staging_count':len(y),'changed_objects':len(changes),'classifications':dict(Counter(c['classification'] for c in changes)),
                          'array_order_also_equal':a[section]==b[section]}
    return {'summary':summary,'objects':result,'scalar_changes':{k:{'local':a[k],'staging':b[k]} for k in ('server_version_num','format_version') if a[k]!=b[k]},'authorizes_apply':False}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--local',required=True,type=Path);p.add_argument('--staging',required=True,type=Path);p.add_argument('--output',required=True,type=Path);args=p.parse_args()
    result=diff(json.loads(args.local.read_bytes()),json.loads(args.staging.read_bytes()))
    result['inputs']={str(path):hashlib.sha256(path.read_bytes()).hexdigest() for path in (args.local,args.staging)}
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(result['summary'],ensure_ascii=False))
