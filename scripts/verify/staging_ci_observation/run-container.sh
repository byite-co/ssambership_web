#!/usr/bin/env bash
set -euo pipefail
# Only an output directory is accepted. No SQL, image, role, or connection input.
[[ $# == 1 ]] || exit 64
[[ ${GITHUB_SHA:-} =~ ^[0-9a-f]{40}$ ]] || exit 64
output_root=$1
[[ ! -e "$output_root" ]] || exit 64
mkdir -m 700 -p "$output_root"
image_name="ssambership-ci-observer:$GITHUB_SHA"
# No credential value is put in argv or a file. The Docker client forwards only
# named environment variables, and this container never starts a DB server.
set +e
docker run --rm --pull=never --platform linux/amd64 \
  --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --user "$(id -u):$(id -g)" --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --mount "type=bind,src=$output_root,dst=/evidence" \
  --env SUPABASE_DB_URL --env GITHUB_ACTIONS --env GITHUB_REF \
  --env GITHUB_EVENT_NAME --env GITHUB_REPOSITORY --env GITHUB_SHA \
  --env GITHUB_RUN_ID --env GITHUB_RUN_ATTEMPT \
  --env GITHUB_WORKFLOW_REF --env GITHUB_WORKFLOW_SHA \
  "$image_name" --output /evidence/observation 2>/dev/null
container_exit=$?
set -e
printf '{"container_exit_code":%d,"HOLD":true,"scope":"container launcher; inspect observation/manifest.json for DB call count"}\n' "$container_exit" > "$output_root/launcher.json"
chmod 600 "$output_root/launcher.json"
if [[ $container_exit != 0 ]]; then
  printf '%s\n' 'OBSERVATION_CONTAINER_FAILED_HOLD_RETAINED' >&2
fi
exit "$container_exit"
