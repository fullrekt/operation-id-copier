#!/bin/zsh
cd -- "$(dirname -- "$0")/bridge" || exit 1
python3 background.py stop
