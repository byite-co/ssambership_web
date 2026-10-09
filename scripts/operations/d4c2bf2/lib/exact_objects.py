"""A lossless, identity-keyed catalog representation for cross-locale comparison.

All rows and every value (including raw CRLF, comment, null ACL and attnum) are
preserved. Duplicate identities fail. Only the order of catalog result rows is
not a database contract. Historical format-v2 artifacts are not rewritten.
"""
import json
from compare_catalogs import KEYS

def keyed(snapshot):
    assert set(snapshot)==set(KEYS)|{'format_version','server_version_num'}
    assert snapshot['format_version']==2
    out={'format_version':3,'server_version_num':snapshot['server_version_num']}
    for section,fields in KEYS.items():
        rows=snapshot[section];objects={}
        for row in rows:
            identity=json.dumps([row[f] for f in fields],ensure_ascii=False)
            if identity in objects:raise ValueError('DUPLICATE_CATALOG_IDENTITY '+section+' '+identity)
            objects[identity]=row
        out[section]=objects
    return out

def expression(raw_expression):
    parts=["'format_version',3", "'server_version_num',c->'server_version_num'"]
    for section,fields in KEYS.items():
        key="jsonb_build_array("+','.join("r->'"+f+"'" for f in fields)+")::text"
        # Count travels with the aggregate: a duplicate cannot silently replace
        # a row in jsonb_object_agg. Division-by-zero rejects malformed input.
        value="(SELECT CASE WHEN count(*)=count(DISTINCT "+key+") THEN coalesce(jsonb_object_agg("+key+",r),'{}'::jsonb) ELSE to_jsonb(1/(count(*)-count(*))) END FROM jsonb_array_elements(c->'"+section+"') r)"
        parts += ["'"+section+"',"+value]
    return "SELECT jsonb_build_object("+','.join(parts)+") FROM ("+raw_expression+") raw(c)"
