#!/usr/bin/env bash
set -Eeuo pipefail
if [[ $# -lt 3 || $# -gt 4 ]]; then
  echo 'Usage: launch.sh STANDALONE_CHECKOUT EXPECTED_SOURCE_SHA STATE_DIRECTORY [PR_NUMBER]' >&2
  exit 2
fi
checkout_dir=$(realpath "$1")
source_sha=$2
state_dir=$(realpath -m "$3")
engine_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
pr_number=${4:-}
[[ -z "$pr_number" || "$pr_number" =~ ^[1-9][0-9]*$ ]]
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]]
[[ -d "$checkout_dir/.git" ]]
test "$(git -C "$checkout_dir" rev-parse HEAD)" = "$source_sha"
git -C "$checkout_dir" diff --exit-code HEAD --
test "$(git -C "$checkout_dir" remote get-url origin)" = 'https://github.com/bachngan-vigifts/baogiabachngan_v2.git'
if git -C "$checkout_dir" config --local --name-only --get-regexp 'credential|extraheader' >/dev/null; then
  echo 'Refusing checkout with local credential configuration.' >&2
  exit 2
fi
mkdir -p "$state_dir"/{jobs,artifacts,cache/npm,runtime/node22}
exec 9>"$state_dir/worker.lock"
flock --nonblock 9 || { echo 'Worker busy; keep request queued.' >&2; exit 75; }
docker_local() {
  env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock "$@"
}
if [[ -n "$(docker_local ps -q --filter name=crm-chatgpt-tester-)" ]]; then
  echo 'Another tester container is active; keep request queued.' >&2
  exit 75
fi
python3 -c 'import os,sys; s=os.statvfs(sys.argv[1]); assert s.f_bavail*s.f_frsize >= 3*1024**3, "At least 3 GiB free is required"' "$state_dir"
worker_uid=$(id -u)
[[ "$worker_uid" -ge 1000 ]] || { echo 'Run this launcher as a non-root cloud user.' >&2; exit 2; }
node_root="$state_dir/runtime/node22"
if [[ ! -x "$node_root/bin/node" ]] || [[ "$("$node_root/bin/node" --version)" != v22.22.0 ]]; then
  node_download=$(mktemp -d "$state_dir/runtime/download-XXXXXX")
  curl --fail --silent --show-error --location https://nodejs.org/dist/v22.22.0/node-v22.22.0-linux-x64.tar.xz -o "$node_download/node.tar.xz"
  curl --fail --silent --show-error --location https://nodejs.org/dist/v22.22.0/SHASUMS256.txt -o "$node_download/SHASUMS256.txt"
  (cd "$node_download" && awk '$2 == "node-v22.22.0-linux-x64.tar.xz" {print $1 "  node.tar.xz"}' SHASUMS256.txt > CHECKSUM && test -s CHECKSUM && sha256sum --check CHECKSUM)
  tar -xJf "$node_download/node.tar.xz" -C "$node_root" --strip-components=1
  rm -rf "$node_download"
fi
test "$("$node_root/bin/node" --version)" = v22.22.0
job_id=$(python3 -c 'import uuid;print(uuid.uuid4().hex)')
control_dir="$state_dir/jobs/$job_id"
report_dir="$state_dir/artifacts/$job_id"
mkdir "$control_dir" "$report_dir"
container_name="crm-chatgpt-tester-$job_id"
container_created=false
job_phase=setup
publish_started=false
cleanup() {
  local result=$?
  local final_result=$result
  local cleanup_ok=true
  set +e
  if [[ "$container_created" = true ]]; then
    docker_local stop -t 15 "$container_name" >/dev/null 2>&1 || cleanup_ok=false
    docker_local rm -f "$container_name" >/dev/null 2>&1 || cleanup_ok=false
  fi
  JOB_EXIT="$result" JOB_PHASE="$job_phase" CLEANUP_OK="$cleanup_ok" python3 -c 'import json,os,sys,datetime,hashlib; json.dump({"exit_code":int(os.environ["JOB_EXIT"]),"phase":os.environ["JOB_PHASE"],"cleanup_ok":os.environ["CLEANUP_OK"]=="true","finished_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"runner_sha256_after":hashlib.sha256(open(sys.argv[2],"rb").read()).hexdigest()},open(sys.argv[1],"w"))' "$control_dir/process-result.json" "$engine_dir/runner.mjs"
  [[ "$cleanup_ok" = true ]] || final_result=2
  if [[ "$publish_started" = true ]]; then
    python3 "$engine_dir/publish.py" finish "$control_dir" >"$control_dir/publish-result.log" 2>&1
    local publish_result=$?
    if [[ "$publish_result" -gt 1 ]]; then
      echo 'Publishing blocked; do not treat this job as a successful GitHub check.' >&2
      final_result=2
    elif [[ "$publish_result" -ne 0 && "$final_result" -eq 0 ]]; then
      final_result=1
    fi
  fi
  echo "Cloud tester job: $job_id; process exit: $result; reports: $report_dir"
  trap - EXIT
  exit "$final_result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
SOURCE_SHA="$source_sha" REPORT_DIR="$report_dir" ENGINE_FILE="$engine_dir/runner.mjs" JOB_ID="$job_id" python3 -c 'import json,os,sys,hashlib,datetime; json.dump({"schema_version":1,"job_id":os.environ["JOB_ID"],"kind":"baseline","repository":"bachngan-vigifts/baogiabachngan_v2","source_sha":os.environ["SOURCE_SHA"],"reports_dir":os.environ["REPORT_DIR"],"runner_sha256":hashlib.sha256(open(os.environ["ENGINE_FILE"],"rb").read()).hexdigest(),"started_at":datetime.datetime.now(datetime.timezone.utc).isoformat()},open(sys.argv[1],"w"),indent=2)' "$control_dir/manifest.json"
if [[ -n "$pr_number" ]]; then
  gh api "repos/bachngan-vigifts/baogiabachngan_v2/pulls/$pr_number" >"$control_dir/pull-request.json"
  gh api repos/bachngan-vigifts/baogiabachngan_v2/branches/main >"$control_dir/base-branch.json"
  PR_NUMBER="$pr_number" python3 -c 'import json,os,sys,subprocess; from pathlib import Path; d=Path(sys.argv[1]); m=json.loads((d/"manifest.json").read_text()); p=json.loads((d/"pull-request.json").read_text()); b=json.loads((d/"base-branch.json").read_text()); assert p["state"]=="open" and not p["draft"] and p["base"]["ref"]=="main"; assert p["head"]["repo"]["full_name"]==m["repository"], "Forks require separate review"; assert p["merge_commit_sha"]==m["source_sha"], "Fetch the current PR merge candidate"; parents=subprocess.check_output(["git","-C",sys.argv[2],"show","-s","--format=%P",m["source_sha"]],text=True).split(); assert parents==[b["commit"]["sha"],p["head"]["sha"]], "Merge candidate parents changed"; m.update(kind="pr",pr_number=int(os.environ["PR_NUMBER"]),head_sha=p["head"]["sha"],base_sha=b["commit"]["sha"]); (d/"manifest.json").write_text(json.dumps(m,indent=2))' "$control_dir" "$checkout_dir"
  python3 "$engine_dir/publish.py" start "$control_dir"
  publish_started=true
fi
# npm itself is trusted; repository/dependency lifecycle code is not executed on the host.
network_env=()
for key in HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy SSL_CERT_FILE SSL_CERT_DIR; do
  [[ -z "${!key:-}" ]] || network_env+=("$key=${!key}")
done
cloud_ca=${CODEX_PROXY_CERT:-/etc/ssl/certs/ca-certificates.crt}
(
  cd "$checkout_dir"
  timeout 600 env -i "${network_env[@]}" PATH="$node_root/bin:/usr/local/bin:/usr/bin:/bin" NODE_EXTRA_CA_CERTS="$cloud_ca" CI=true "$node_root/bin/npm" ci --ignore-scripts --no-audit --no-fund --userconfig=/dev/null --cache="$state_dir/cache/npm"
) >"$control_dir/dependencies.log" 2>&1
docker_local run -d --name "$container_name" --cpus 4 --memory 12g --pids-limit 1024 --init --security-opt no-new-privileges:true --workdir /job \
  --mount "type=bind,src=$node_root,dst=/opt/node22,readonly" \
  --mount "type=bind,src=$checkout_dir,dst=/source,readonly" \
  --mount "type=bind,src=$engine_dir/runner.mjs,dst=/opt/cloud-runner.mjs,readonly" \
  --mount "type=bind,src=$report_dir,dst=/reports" \
  --env PATH=/opt/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin --env CI=true \
  php@sha256:98d555ff97b3865140ad31032508c3ca089fa97a8944b14ca9dc03ea05d788cd sleep infinity >"$control_dir/container-id.txt"
container_created=true
timeout 600 env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock exec "$container_name" bash -lc 'set -e; apt-get update; apt-get install -y --no-install-recommends git util-linux passwd python3 jq curl libfontconfig1; useradd --uid "$1" --create-home --shell /bin/bash cloudtester; chown cloudtester:cloudtester /job; rm -rf /var/lib/apt/lists/*' bootstrap "$worker_uid" >"$control_dir/runtime-setup.log" 2>&1
docker_local network disconnect bridge "$container_name"
test "$(docker_local inspect "$container_name" --format '{{len .NetworkSettings.Networks}}')" = 0
job_phase=test
set +e
docker_local exec "$container_name" runuser -u cloudtester -- /opt/node22/bin/node /opt/cloud-runner.mjs /source /reports "$source_sha" >"$report_dir/runner.log" 2>&1
test_exit=$?
set -e
job_phase=complete
exit "$test_exit"
