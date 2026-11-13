#!/usr/bin/env python3
"""Credentials are entered locally and never printed or added to source files."""
import getpass
import json
import os
from pathlib import Path
import re
import secrets

folder = Path.home() / 'Library' / 'Application Support' / 'Operation ID' / 'bridge' / '.local'
folder.mkdir(mode=0o700, parents=True, exist_ok=True)
os.chmod(folder, 0o700)
target = folder / 'config.json'
try:
    old = json.loads(target.read_text())
except (FileNotFoundError, json.JSONDecodeError):
    try:
        old = json.loads((Path(__file__).resolve().parent / '.local' / 'config.json').read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        old = {}

def ask(label, key, default=''):
    value = str(old.get(key, default) or '')
    answer = input(label + (' [' + value + ']' if value else '') + ': ').strip()
    return answer or value

def main():
    print('Настройка PostgreSQL. Пароль вводится скрыто и хранится только локально.\n')
    result = {}
    result['host'] = ask('Хост', 'host', 'localhost')
    result['port'] = int(ask('Порт', 'port', 5432))
    result['database'] = ask('Имя базы', 'database')
    result['schema'] = ask('Схема таблицы report_stock', 'schema', 'public')
    result['user'] = ask('Логин', 'user')
    result['password'] = getpass.getpass('Пароль' + (' (Enter — оставить прежний)' if old.get('password') else '') + ': ') or old.get('password', '')
    result['sslMode'] = ask('SSL: verify-full (проверять сертификат) или disable (если SSL не используется)', 'sslMode', 'verify-full')
    result['caFile'] = ask('Путь к корневому сертификату, если он нужен', 'caFile')
    result['extensionId'] = ask('ID расширения Operation ID из chrome://extensions', 'extensionId')
    if not all(result[k] for k in ['host', 'database', 'user', 'password']):
        raise ValueError('Хост, база, логин и пароль обязательны.')
    if not 1 <= result['port'] <= 65535:
        raise ValueError('Порт должен быть от 1 до 65535.')
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', result['schema']):
        raise ValueError('Некорректная схема.')
    if not re.fullmatch(r'[a-p]{32}', result['extensionId']):
        raise ValueError('ID расширения должен состоять из 32 букв a–p.')
    if result['sslMode'] not in ['verify-full', 'disable']:
        raise ValueError('Режим SSL: verify-full или disable.')
    if result['caFile']:
        result['caFile'] = str(Path(result['caFile']).expanduser().resolve(strict=True))
    result['token'] = old.get('token') or secrets.token_hex(32)
    temp = folder / 'config.tmp'
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
    os.replace(temp, target)
    os.chmod(target, 0o600)
    print('\nНастройки сохранены. Пароль в расширение не передаётся.')
    print('Вставь этот ключ в раздел «Подключение» расширения:\n' + result['token'])

if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        print('\nНастройка не сохранена: ' + str(error))
        raise SystemExit(1)
    except (KeyboardInterrupt, EOFError):
        print('\nНастройка отменена.')
        raise SystemExit(1)
