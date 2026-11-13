#!/bin/zsh
cd -- "$(dirname -- "$0")/bridge" || exit 1
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  printf 'Нужен Node.js 22 или новее: https://nodejs.org\n'
  read -r response
  exit 1
fi
if [[ ! -d node_modules/pg ]]; then
  npm ci --ignore-scripts || { read -r response; exit 1; }
fi
python3 background.py start
service_status=$?
if [[ $service_status -ne 0 ]]; then
  printf '\nНажми Enter, чтобы закрыть окно.'
  read -r response
fi
exit $service_status
