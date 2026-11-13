#!/bin/zsh
cd -- "$(dirname -- "$0")/bridge" || exit 1
python3 configure.py
configuration_status=$?
if [[ $configuration_status -eq 0 ]]; then
  python3 background.py stop >/dev/null
  ../Запустить\ БД.command
fi
printf '\nНажми Enter, чтобы закрыть окно.'
read -r response
exit $configuration_status
