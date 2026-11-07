#!/bin/bash
cd "$(dirname "$0")"
bash scripts/run.sh
printf '\nPress Enter to close.'
read -r
