#!/usr/bin/env python3
"""Run this user's local bridge through launchd, independently of Terminal."""
import argparse
import http.client
import json
import os
from pathlib import Path
import plistlib
import re
import secrets
import shutil
import subprocess
import sys
import time

SOURCE = Path(__file__).resolve().parent

def command(*args):
    return subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=15)

def ready(config):
    connection = http.client.HTTPConnection('127.0.0.1', 17879, timeout=1)
    try:
        connection.request('POST', '/query', body='{"ids":[]}', headers={
            'Origin': 'chrome-extension://' + config['extensionId'],
            'Authorization': 'Bearer ' + config['token'],
            'Content-Type': 'application/json'
        })
        response = connection.getresponse()
        data = json.loads(response.read())
        return response.status == 400 and 'корректных operation_id' in data.get('error', '')
    except (OSError, ValueError, KeyError):
        return False
    finally:
        connection.close()

def prepare(runtime):
    runtime.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(runtime, 0o700)
    local = runtime / '.local'
    local.mkdir(mode=0o700, exist_ok=True)
    os.chmod(local, 0o700)
    config_path = local / 'config.json'
    if not config_path.exists():
        legacy = SOURCE / '.local' / 'config.json'
        if not legacy.exists():
            raise ValueError('Сначала запусти «Настроить БД.command».')
        shutil.copy2(legacy, config_path)
    os.chmod(config_path, 0o600)
    config = json.loads(config_path.read_text())
    if not re.fullmatch(r'[a-p]{32}', config.get('extensionId', '')):
        raise ValueError('Сначала укажи ID расширения через «Настроить БД.command».')
    if not config.get('token'):
        config['token'] = secrets.token_hex(32)
        config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2))
        os.chmod(config_path, 0o600)
    node = shutil.which('node')
    if not node:
        node = next((p for p in ['/opt/homebrew/bin/node', '/usr/local/bin/node'] if Path(p).exists()), None)
    if not node or int(command(node, '--version').stdout.strip().lstrip('v').split('.')[0]) < 22:
        raise ValueError('Нужен Node.js версии 22 или новее.')
    if not (SOURCE / 'node_modules' / 'pg').is_dir():
        raise ValueError('Драйвер pg не установлен. Запусти «Запустить БД.command».')
    for name in ['server.mjs', 'api.mjs']:
        shutil.copy2(SOURCE / name, runtime / name)
    shutil.copytree(SOURCE / 'node_modules', runtime / 'node_modules', dirs_exist_ok=True)
    return config, str(Path(node).resolve()), local

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['start', 'stop', 'restart', 'status'])
    parser.add_argument('--runtime', type=Path, default=Path.home() / 'Library' / 'Application Support' / 'Operation ID' / 'bridge')
    parser.add_argument('--label', default='local.operation-id-copier')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', args.label):
        raise ValueError('Некорректное имя сервиса.')
    target = 'gui/' + str(os.getuid()) + '/' + args.label
    domain = 'gui/' + str(os.getuid())
    loaded = command('/bin/launchctl', 'print', target).returncode == 0

    if args.action == 'status':
        if loaded:
            print('Фоновый сервис загружен.')
        else:
            print('Фоновый сервис остановлен.')
        return 0 if loaded else 1

    if args.action in ['stop', 'restart'] and loaded:
        result = command('/bin/launchctl', 'bootout', target)
        if result.returncode:
            raise ValueError('Не удалось остановить фоновый сервис.')
        for _ in range(30):
            if command('/bin/launchctl', 'print', target).returncode != 0:
                break
            time.sleep(0.1)
        loaded = False
    if args.action == 'stop':
        print('Фоновый сервис остановлен. БД не изменялась.')
        return 0

    config, node, local = prepare(args.runtime)
    if loaded:
        if ready(config):
            print('Сервис уже работает в фоне. Terminal можно закрыть.')
            return 0
        raise ValueError('Сервис загружен, но не отвечает. Запусти команду остановки и затем запуска.')
    log = local / 'service.log'
    if log.exists() and log.stat().st_size > 512 * 1024:
        log.replace(local / 'service.previous.log')
    log.touch(mode=0o600, exist_ok=True)
    os.chmod(log, 0o600)
    plist = local / 'agent.plist'
    with plist.open('wb') as stream:
        plistlib.dump({
            'Label': args.label,
            'ProgramArguments': [node, str(args.runtime / 'server.mjs')],
            'WorkingDirectory': str(args.runtime),
            'RunAtLoad': True,
            'KeepAlive': False,
            'ProcessType': 'Background',
            'ExitTimeOut': 10,
            'StandardOutPath': str(log),
            'StandardErrorPath': str(log),
            'EnvironmentVariables': {'PATH': str(Path(node).parent) + ':/usr/bin:/bin:/usr/sbin:/sbin'}
        }, stream)
    os.chmod(plist, 0o600)
    result = command('/bin/launchctl', 'bootstrap', domain, str(plist))
    if result.returncode:
        raise ValueError('macOS не разрешила запустить сервис. Проверь, что команда запущена в твоём пользовательском сеансе.')
    for _ in range(60):
        if ready(config):
            print('Сервис запущен в фоне. Terminal можно закрыть.')
            if not all(config.get(key) for key in ['user', 'password', 'sslMode']):
                print('Осталось один раз запустить «Настроить БД.command» и ввести логин и пароль.')
            return 0
        time.sleep(0.1)
    command('/bin/launchctl', 'bootout', target)
    raise ValueError('Сервис не запустился. Журнал: ' + str(log))

if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
