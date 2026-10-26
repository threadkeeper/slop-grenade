#!/usr/bin/env bash
set -euo pipefail
[[ ( $# == 1 || $# == 2 ) && -f "$1" && ( "${2:-}" == "" || "${2:-}" == "--write" ) ]] || {
  printf '%s\n' "Expected one existing artifact file and optional --write." >&2; exit 1;
}
python -c '
import hashlib,os,pathlib,sys,tempfile
artifact=pathlib.Path(sys.argv[1])
digest=hashlib.sha256()
with artifact.open("rb") as source:
    for chunk in iter(lambda:source.read(1024*1024),b""):
        digest.update(chunk)
checksum=digest.hexdigest()
if sys.argv[2]=="--write":
    sidecar=artifact.with_name(artifact.name+".sha256")
    temporary=None
    try:
        with tempfile.NamedTemporaryFile(mode="w",encoding="utf-8",prefix=sidecar.name+".",
                dir=artifact.parent,delete=False) as output:
            temporary=pathlib.Path(output.name)
            output.write(checksum+"  "+artifact.name+"\n")
        os.replace(temporary,sidecar)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
print(checksum+"  "+str(artifact))
' "$1" "${2:-}"
